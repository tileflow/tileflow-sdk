import Foundation
import XCTest

@testable import Tileflow

final class ResourcePolicyTests: XCTestCase {
  func testOriginPolicyNeverInheritsCredentialsAcrossOrigins() throws {
    let policy = ResourcePolicy(origins: ["https://maps.example.com"])
    try policy.validate(URL(string: "https://maps.example.com:443/tiles/0/0/0")!)
    for value in [
      "https://maps.example.com.evil.test/style.json",
      "https://maps.example.com:444/style.json",
      "https://user:password@maps.example.com/style.json",
      "http://maps.example.com/style.json",
      "file:///etc/passwd",
      "https://maps.example.com/style.json#fragment",
    ] {
      XCTAssertThrowsError(try policy.validate(URL(string: value)!))
    }
  }

  func testDevelopmentHTTPIsExplicitAndLimitedToLoopback() throws {
    let origin = "http://127.0.0.1:8765"
    XCTAssertThrowsError(try ResourcePolicy(origins: [origin]).validate(URL(string: origin)!))
    try ResourcePolicy(origins: [origin], allowsLoopbackHTTP: true).validate(URL(string: origin)!)
    XCTAssertThrowsError(
      try ResourcePolicy(
        origins: ["http://192.168.1.10"], allowsLoopbackHTTP: true
      ).validate(URL(string: "http://192.168.1.10")!))
  }
}
