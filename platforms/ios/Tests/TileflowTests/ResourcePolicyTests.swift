import Foundation
import XCTest

@testable import Tileflow

final class ResourcePolicyTests: XCTestCase {
  func testTemplateExpansionIsBoundedAndCannotChangeAuthority() throws {
    let template = URL(string: "https://terrain.example.com/%7Bz%7D/%7Bx%7D/%7By%7D.png")!
    let base = ResourceURL.encode(template).absoluteString
    XCTAssertEqual(
      try ResourceURL.decode(URL(string: base + "/3/4/5")!).absoluteString,
      "https://terrain.example.com/3/4/5.png")
    for suffix in ["/3/8/0", "/25/0/0", "/01/0/0", "/3/4/5/extra", "/3/-1/2"] {
      XCTAssertThrowsError(try ResourceURL.decode(URL(string: base + suffix)!))
    }
  }

  func testCanonicalTransportAddressesRoundTripWithoutAuthority() throws {
    let original = URL(string: "https://maps.example.com/tiles/12/34/56.pbf?revision=abc")!
    XCTAssertEqual(try ResourceURL.decode(ResourceURL.encode(original)), original)
    for value in [
      "tileflow://resource/abc?key=x",
      "tileflow://user@resource/abc",
      "tileflow://resource:123/abc",
      "tileflow://runtime/abc",
      "tileflow://resource/../abc",
      "tileflow://resource/a%2Fb",
    ] {
      XCTAssertThrowsError(try ResourceURL.decode(URL(string: value)!))
    }
  }

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
