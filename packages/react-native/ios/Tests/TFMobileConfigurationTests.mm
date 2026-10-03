#import <XCTest/XCTest.h>
#import "../TFMobileConfiguration.h"

@interface TFMobileConfigurationTests : XCTestCase
@end

@implementation TFMobileConfigurationTests
- (NSString *)credential {
	return [@"tf_public_" stringByAppendingString:[@"" stringByPaddingToLength:48 withString:@"a" startingAtIndex:0]];
}
- (NSArray *)values:(NSString *)origin {
	return @[[ @"apiOrigin=" stringByAppendingString:origin], [@"credential=" stringByAppendingString:[self credential]]];
}
- (void)assertInvalid:(id)input {
	NSError *error = nil;
	XCTAssertNil([TFMobileConfiguration parse:input error:&error]);
	XCTAssertEqualObjects(error.domain, @"TileflowNativeConfiguration");
	XCTAssertEqualObjects(error.localizedDescription, @"Native application configuration is invalid.");
	XCTAssertNil(error.userInfo[NSUnderlyingErrorKey]);
	XCTAssertFalse([error.description containsString:[self credential]]);
	XCTAssertFalse([error.description containsString:@"api.example.test"]);
}
- (void)testCanonicalOrigins {
	NSArray *cases = @[
		@[@"HTTPS://API.Example.test:443/", @"https://api.example.test"],
		@[@"https://api.example.test:8443/", @"https://api.example.test:8443"],
		@[@"https://127.0.0.1:65535", @"https://127.0.0.1:65535"],
		@[@"https://xn--bcher-kva.example", @"https://xn--bcher-kva.example"],
		@[@"https://localhost/", @"https://localhost"]
	];
	for (NSArray *entry in cases) {
		NSError *error = nil;
		TFMobileConfiguration *value = [TFMobileConfiguration parse:[self values:entry[0]] error:&error];
		XCTAssertNil(error);
		XCTAssertEqualObjects(value.apiOrigin, entry[1]);
		XCTAssertEqualObjects(value.credential, [self credential]);
	}
}
- (void)testRejectsUrlRecoveryAndNonOriginComponents {
	for (NSString *origin in @[
		@"", @" https://api.example.test", @"https://api.example.test\n", @"http://api.example.test",
		@"//api.example.test", @"https://api.example.test/path", @"https://api.example.test//",
		@"https://api.example.test/.", @"https://api.example.test/..", @"https://api.example.test?",
		@"https://api.example.test/#", @"https://user@api.example.test", @"https://api.example.test\\",
		@"https://api.%65xample.test", @"https://bücher.example", @"https://\u212A.example", @"https://\u017F.example",
		@"https://api.example.test.", @"https://*.example.test", @"https://bad_host.example",
		@"https://-bad.example", @"https://bad-.example", @"https://a..example", @"https://api.example.test:0",
		@"https://api.example.test:0443", @"https://api.example.test:65536", @"https://api.example.test:",
		@"https://127.1", @"https://0177.0.0.1", @"https://0x7f000001", @"https://2130706433",
		@"https://example.0x1", @"https://256.0.0.1", @"https://[::1]",
		[@"https://" stringByAppendingString:[@"" stringByPaddingToLength:2049 withString:@"a" startingAtIndex:0]]
	]) [self assertInvalid:[self values:origin]];
}
- (void)testMissingWrongTypedPartialAndDuplicateValues {
	NSArray *valid = [self values:@"https://api.example.test"];
	for (id input in @[
		NSNull.null, @1, @"configuration", @{}, @[], @[valid[0]], @[valid[0], @1],
		@[valid[0], NSNull.null], @[valid[0], @"credential="],
		@[valid[0], [valid[1] stringByAppendingString:@"\n"]], @[valid[0], [valid[1] uppercaseString]],
		@[valid[0], [valid[1] stringByAppendingString:@"a"]],
		@[valid[0], [valid[1] substringToIndex:[valid[1] length] - 1]],
		@[valid[0], valid[0]], @[valid[0], @"apiOrigin=https://other.example"],
		@[valid[0], valid[1], valid[1]], @[valid[0], valid[1], @"unknown=value"]
	]) [self assertInvalid:input];
	[self assertInvalid:nil];
	TFMobileConfiguration *reordered =
		[TFMobileConfiguration parse:@[valid[1], valid[0]] error:nil];
	XCTAssertNotNil(reordered);
}
- (void)testApplicationInfoHasNoLocalizedOrAlternatePrecedence {
	NSDictionary *info = @{@"TileflowMobileConfiguration": [self values:@"https://api.example.test"]};
	XCTAssertNotNil([TFMobileConfiguration fromInfo:info localized:@{} error:nil]);
	for (id override in @[[self values:@"https://other.example"], info[@"TileflowMobileConfiguration"], @"wrong type", NSNull.null]) {
		NSError *error = nil;
		XCTAssertNil([TFMobileConfiguration fromInfo:info localized:@{@"TileflowMobileConfiguration": override} error:&error]);
		XCTAssertEqualObjects(error.localizedDescription, @"Native application configuration is invalid.");
	}
	XCTAssertNil([TFMobileConfiguration fromInfo:@{} localized:@{} error:nil]);
	XCTAssertNil([TFMobileConfiguration fromInfo:@{@"TileflowMobileConfiguration": @{}} localized:@{} error:nil]);
}
- (void)testMutableInputCannotChangeCachedValuesOrDescriptions {
	NSMutableString *entry = [[@"credential=" stringByAppendingString:[self credential]] mutableCopy];
	NSMutableArray *values = [@[@"apiOrigin=https://api.example.test", entry] mutableCopy];
	TFMobileConfiguration *config = [TFMobileConfiguration parse:values error:nil];
	[entry setString:@"changed"];
	[values removeAllObjects];
	XCTAssertEqualObjects(config.credential, [self credential]);
	XCTAssertEqualObjects(config.apiOrigin, @"https://api.example.test");
	XCTAssertEqualObjects(config.description, @"TFMobileConfiguration");
	XCTAssertEqualObjects(config.debugDescription, @"TFMobileConfiguration");
}
- (void)testCacheReadsOnceAndRetainsOnlySafeFailure {
	TFMobileConfigurationCache *cache = [TFMobileConfigurationCache new];
	__block NSUInteger reads = 0;
	TFMobileConfiguration *(^read)(void) = ^{
		reads++;
		return [TFMobileConfiguration parse:[self values:@"https://api.example.test"] error:nil];
	};
	TFMobileConfiguration *first = [cache read:read error:nil];
	XCTAssertNotNil(first);
	XCTAssertEqual(first, [cache read:read error:nil]);
	XCTAssertEqual(reads, 1u);
	TFMobileConfigurationCache *broken = [TFMobileConfigurationCache new];
	for (NSUInteger index = 0; index < 2; index++) {
		NSError *error = nil;
		XCTAssertNil([broken read:^{
			reads++;
			@throw [NSException exceptionWithName:@"Fixture" reason:[self credential] userInfo:nil];
			return (TFMobileConfiguration *)nil;
		} error:&error]);
		XCTAssertFalse([error.description containsString:[self credential]]);
	}
	XCTAssertEqual(reads, 2u);
}
- (void)testReentrantFailureCannotPublishAConfiguration {
	TFMobileConfigurationCache *cache = [TFMobileConfigurationCache new];
	XCTAssertNil([cache read:^{
		XCTAssertNil([cache read:^{ return [TFMobileConfiguration parse:[self values:@"https://api.example.test"] error:nil]; } error:nil]);
		return [TFMobileConfiguration parse:[self values:@"https://api.example.test"] error:nil];
	} error:nil]);
	XCTAssertNil([cache read:^{ return [TFMobileConfiguration parse:[self values:@"https://api.example.test"] error:nil]; } error:nil]);
}
@end
