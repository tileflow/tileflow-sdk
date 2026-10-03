#import <XCTest/XCTest.h>
#import "TFAdmissionEngine.h"
#import "TFAdmissionCatalog.h"

@interface TFNativeStyleRouteTests : XCTestCase
@end

@implementation TFNativeStyleRouteTests
- (void)testExactVersionedStyleMapOwnership {
	NSString *map = @"map_0123456789abcdef";
	NSString *other = @"map_abcdefghijklmnop";
	for (NSString *version in @[@"1", @"7", @"9007199254740991"]) {
		NSString *url = [NSString stringWithFormat:@"https://api.example.test/maps/%@/native/v%@/light.json", map, version];
		XCTAssertTrue(TFAdmissionStyleMatchesMap(url, map));
		XCTAssertFalse(TFAdmissionStyleMatchesMap(url, other));
		XCTAssertEqualObjects(TFAdmissionCleanURL(url), url);
	}
}
- (void)testReservedStyleRoutesRejectAliasesAndMetadata {
	NSString *map = @"map_0123456789abcdef";
	NSString *base = [NSString stringWithFormat:@"https://api.example.test/maps/%@", map];
	for (NSString *suffix in @[
		@"/native/v0/light.json", @"/native/v07/light.json", @"/native/v-1/light.json",
		@"/native/v9007199254740992/light.json", @"/%6eative/v7/light.json",
		@"/native/v7/%6cight.json", @"/native/v7/light.json?alias=1",
		@"/native/v7/light.json#fragment", @"/native/manifest.json"
	]) XCTAssertFalse(TFAdmissionStyleMatchesMap([base stringByAppendingString:suffix], map));
	XCTAssertTrue(TFAdmissionStyleMatchesMap([base stringByAppendingString:@"/light.json"], map));
}
- (void)testContextDiscriminatorNeverChangesVersionOrMapIdentity {
	NSString *url = @"https://api.example.test/maps/map_0123456789abcdef/native/v7/light.json";
	NSDictionary *stripped = TFAdmissionStripContext([url stringByAppendingString:@"?__tf_native_context=installation.1"]);
	XCTAssertEqualObjects(stripped[@"context"], @"installation.1");
	XCTAssertEqualObjects(stripped[@"url"], url);
	XCTAssertTrue(TFAdmissionStyleMatchesMap(stripped[@"url"], @"map_0123456789abcdef"));
	XCTAssertFalse(TFAdmissionStyleMatchesMap(stripped[@"url"], @"map_abcdefghijklmnop"));
}
@end
