import Foundation

struct HostedAdmission: Sendable {
  let grant: String?
  let timeout: TimeInterval
}

/// One logical map instance owns this actor across renderer generations.
actor HostedSession {
  private let client: TileflowClient
  private let mapID: String
  private let surfaceID: String
  private let lifetime: SessionLifetime
  private let now: @Sendable () -> ContinuousClock.Instant
  private var sessionID = UUID().uuidString
  private var startedAt = ContinuousClock.now
  private var serverStartedAt: Date?
  private var lastServerTime: Date?
  private var requestCount = 0
  private var stored: (authority: HostedAuthority, until: ContinuousClock.Instant)?
  private var operation: (id: UUID, task: Task<HostedAuthority, any Error>)?
  private var terminal: TileflowMapError?
  // Recoverable bootstrap failures delay the next bootstrap; a still-valid grant keeps admitting.
  private var failures = 0
  private var delay: (until: ContinuousClock.Instant, error: TileflowMapError)?
  private var backgrounded = false

  init(
    client: TileflowClient, mapID: String, surfaceID: String,
    transport: any NativeHTTPTransporting = NativeHTTPTransport(maximumBytes: 65_536),
    now: @escaping @Sendable () -> ContinuousClock.Instant = { ContinuousClock.now }
  ) {
    self.client = client
    self.mapID = mapID
    self.surfaceID = surfaceID
    self.lifetime = SessionLifetime(transport: transport)
    self.now = now
    self.startedAt = now()
  }

  /// Retire synchronously before cancelling I/O; late responses cannot revive this owner.
  nonisolated func close() {
    lifetime.close()
    Task { await retire() }
  }

  func setBackgrounded(_ value: Bool) {
    backgrounded = value
    if value {
      operation?.task.cancel()
      operation = nil
    }
  }

  /// Clears a terminal stop and any retry delay; the next admission bootstraps again.
  nonisolated func retry() { lifetime.requestRetry() }

  /// A granted resource was refused for good; the session stops until `retry()`.
  func reject(_ error: TileflowMapError) {
    applyRetry()
    if terminal == nil { terminal = error }
    stored = nil
    operation?.task.cancel()
    operation = nil
  }

  func authorize(_ url: URL, publicPolicy: ResourcePolicy) async throws -> HostedAdmission {
    try checkActive()
    let authority = try await acquire()
    try checkActive()
    if authority.origins.contains(ResourcePolicy.origin(url)) {
      guard HostedContract.permits(url, mapID: mapID, authority: authority),
        let current = stored, current.authority.grant == authority.grant
      else { throw TileflowMapError.accessDenied }
      let until = current.until
      let remaining = durationSeconds(now().duration(to: until)) - 0.5
      guard remaining > 0 else { throw TileflowMapError.sessionUnavailable }
      requestCount += 1
      return HostedAdmission(grant: authority.grant, timeout: min(30, remaining))
    }
    try publicPolicy.validate(url)
    // An API endpoint can never silently become anonymous when its signed origin is missing.
    guard ResourcePolicy.origin(url) != ResourcePolicy.origin(client.apiOrigin) else {
      throw TileflowMapError.accessDenied
    }
    return HostedAdmission(grant: nil, timeout: 30)
  }

  private func acquire() async throws -> HostedAuthority {
    try checkActive()
    if let operation { return try await operation.task.value }
    if requestCount >= 10_000 || durationSeconds(startedAt.duration(to: now())) >= 21_600 {
      rotate()
    }
    if let stored, stored.until > now().advanced(by: .seconds(30)) { return stored.authority }
    if let delay, now() < delay.until {
      if let stored, stored.until > now() { return stored.authority }
      throw delay.error
    }
    let id = UUID()
    let task = Task { try await self.refresh() }
    operation = (id, task)
    do {
      let result = try await task.value
      if operation?.id == id { operation = nil }
      return result
    } catch {
      if operation?.id == id { operation = nil }
      if let terminal { throw terminal }
      throw error
    }
  }

  private func refresh() async throws -> HostedAuthority {
    do {
      let authority = try await bootstrap()
      failures = 0
      delay = nil
      return authority
    } catch let failure as StatusFailure {
      record(failure.error, retryAfter: failure.retryAfter)
      throw failure.error
    } catch let error as TileflowMapError {
      record(error, retryAfter: nil)
      throw error
    }
  }

  /// Credential, access and quota failures stop the session; anything else delays the next
  /// bootstrap by 1 s doubling to 60 s, or longer when the service sends Retry-After.
  private func record(_ error: TileflowMapError, retryAfter: TimeInterval?) {
    guard terminal == nil, !lifetime.isClosed, !Task.isCancelled else { return }
    if HostedContract.isTerminal(error) {
      terminal = error
      stored = nil
      return
    }
    guard [.rateLimited, .sessionUnavailable, .invalidSessionResponse].contains(error) else {
      return
    }
    // Bootstraps are single-flight and none starts during a delay, so each failure counts.
    failures = min(failures + 1, 16)
    let backoff = Duration.seconds(min(1 << (failures - 1), 60))
    let wait = max(backoff, .milliseconds(Int64(((retryAfter ?? 0) * 1000).rounded())))
    delay = (now().advanced(by: wait), error)
  }

  private func bootstrap() async throws -> HostedAuthority {
    for attempt in 0...1 {
      try checkActive()
      try Task.checkCancellation()
      let expectedSession = sessionID
      let requestStarted = now()
      let request = try client.sessionRequest(
        mapID: mapID, sessionID: expectedSession, surfaceID: surfaceID)
      let response: ResourcePayload
      do { response = try await lifetime.transport.send(request) } catch is CancellationError {
        throw CancellationError()
      } catch { throw TileflowMapError.sessionUnavailable }
      try checkActive()
      try Task.checkCancellation()
      guard sessionID == expectedSession else { throw TileflowMapError.disposed }
      if response.status == 409, attempt == 0,
        HostedContract.isRestart(response.bytes, sessionID: expectedSession)
      {
        rotate()
        continue
      }
      guard response.status == 201 else {
        throw StatusFailure(
          error: HostedContract.failure(status: response.status, body: response.bytes),
          retryAfter: HostedContract.retryAfter(response.headers["Retry-After"], now: Date()))
      }
      let authority = try HostedContract.parse(
        response.bytes, mapID: mapID, sessionID: expectedSession, surfaceID: surfaceID)
      if let lastServerTime, authority.serverTime < lastServerTime {
        throw TileflowMapError.invalidSessionResponse
      }
      if let serverStartedAt, authority.serverTime.timeIntervalSince(serverStartedAt) >= 21_600 {
        guard attempt == 0 else { throw TileflowMapError.invalidSessionResponse }
        rotate()
        continue
      }
      let until = requestStarted.advanced(
        by: .seconds(authority.expiresAt.timeIntervalSince(authority.serverTime)))
      guard until > now().advanced(by: .seconds(30)) else {
        throw TileflowMapError.sessionUnavailable
      }
      lastServerTime = authority.serverTime
      serverStartedAt = serverStartedAt ?? authority.serverTime
      stored = (authority, until)
      return authority
    }
    throw TileflowMapError.sessionUnavailable
  }

  private func rotate() {
    sessionID = UUID().uuidString
    startedAt = now()
    serverStartedAt = nil
    lastServerTime = nil
    requestCount = 0
    stored = nil
  }
  private func checkActive() throws {
    if lifetime.isClosed { throw TileflowMapError.disposed }
    applyRetry()
    if let terminal { throw terminal }
    if backgrounded { throw TileflowMapError.notReady }
  }
  private func applyRetry() {
    guard lifetime.takeRetryRequest() else { return }
    terminal = nil
    failures = 0
    delay = nil
  }
  private func retire() {
    operation?.task.cancel()
    operation = nil
    stored = nil
  }
  private func durationSeconds(_ duration: Duration) -> Double {
    Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18
  }
}

/// A failed bootstrap status and the delay the service asked for.
private struct StatusFailure: Error {
  let error: TileflowMapError
  let retryAfter: TimeInterval?
}

/// Lock-protected state that callers change without waiting for the actor.
private final class SessionLifetime: @unchecked Sendable {
  let transport: any NativeHTTPTransporting
  private let lock = NSLock()
  private var closed = false
  private var retryRequested = false
  init(transport: any NativeHTTPTransporting) { self.transport = transport }
  var isClosed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return closed
  }
  /// Recorded synchronously so a renderer mounted right after `retry()` cannot see the old stop.
  func requestRetry() {
    lock.lock()
    retryRequested = true
    lock.unlock()
  }
  func takeRetryRequest() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    let requested = retryRequested
    retryRequested = false
    return requested
  }
  func close() {
    lock.lock()
    closed = true
    lock.unlock()
    transport.close()
  }
}
