#import <XCTest/XCTest.h>
#import "TFAdmissionCatalog.h"

@interface TFAdmissionCatalogTests : XCTestCase
@end
@implementation TFAdmissionCatalogTests
- (NSDictionary *)tile {
	return @{@"url": @"https://tiles.example.test/world/{z}/{x}/{y}.pbf?r=3", @"scope": @"tile", @"tilesetId": @"world", @"template": @"tile"};
}
- (NSDictionary *)glyph {
	return @{@"url": @"https://assets.example.test/fonts/{fontstack}/{range}.pbf", @"scope": @"glyph", @"template": @"glyphs", @"fontStacks": @[@"Noto Sans Regular"]};
}
- (void)testConcreteExpansionPreservesClassTilesetAndQuery {
	TFAdmissionCatalog *catalog = [[TFAdmissionCatalog alloc] initWithResources:@[self.tile, self.glyph]];
	NSString *url = @"https://tiles.example.test/world/2/3/1.pbf?r=3";
	XCTAssertEqualObjects([catalog find:url], (@{@"url": url, @"scope": @"tile", @"tilesetId": @"world"}));
	XCTAssertNotNil([catalog find:@"https://assets.example.test/fonts/Noto%20Sans%20Regular/0-255.pbf"]);
	for (NSString *candidate in @[
		@"https://tiles.example.test/world/2/4/1.pbf?r=3", @"https://tiles.example.test/world/02/3/1.pbf?r=3",
		@"https://tiles.example.test/world/2/%33/1.pbf?r=3", @"https://tiles.example.test:444/world/2/3/1.pbf?r=3",
		@"https://tiles.example.test/other/2/3/1.pbf?r=3", @"https://tiles.example.test/world/2/3/1.pbf?r=4",
		@"https://assets.example.test/fonts/Noto%20Sans%20Italic/0-255.pbf", @"https://assets.example.test/fonts/Noto%20Sans%20Regular/1-256.pbf"
	]) XCTAssertNil([catalog find:candidate]);
}
- (void)testExtensionsAreAtomicAndCannotRebindAResourceIdentity {
	TFAdmissionCatalog *empty = [[TFAdmissionCatalog alloc] initWithResources:@[]];
	TFAdmissionCatalog *first = [empty extending:@[self.tile]];
	TFAdmissionCatalog *retry = [first extending:@[self.tile]];
	XCTAssertEqual(first.resources.count, 1u);
	XCTAssertEqualObjects(first.resources, retry.resources);
	XCTAssertEqual(empty.resources.count, 0u);
	NSMutableDictionary *other = [self.tile mutableCopy]; other[@"tilesetId"] = @"other";
	XCTAssertThrows([first extending:@[other]]);
	NSString *url = @"https://tiles.example.test/world/2/3/1.pbf?r=3";
	TFAdmissionCatalog *ambiguous = [first extending:@[@{@"url": url, @"scope": @"tile", @"tilesetId": @"other"}]];
	XCTAssertThrows([ambiguous find:url]);
	XCTAssertEqualObjects([first find:url][@"tilesetId"], @"world");
}
- (void)testTemplatesAndMutableFontStacksAreValidatedBeforeRegistration {
	NSMutableArray *stacks = [@[@"Noto Sans Regular"] mutableCopy];
	NSMutableDictionary *glyph = [self.glyph mutableCopy]; glyph[@"fontStacks"] = stacks;
	TFAdmissionCatalog *catalog = [[TFAdmissionCatalog alloc] initWithResources:@[glyph]];
	stacks[0] = @"Other";
	XCTAssertNotNil([catalog find:@"https://assets.example.test/fonts/Noto%20Sans%20Regular/0-255.pbf"]);
	for (NSDictionary *resource in @[
		@{@"url": @"https://{x}.example.test/{z}/{x}/{y}.pbf", @"scope": @"tile", @"tilesetId": @"world", @"template": @"tile"},
		@{@"url": self.tile[@"url"], @"scope": @"style", @"template": @"tile"},
		@{@"url": self.glyph[@"url"], @"scope": @"glyph", @"template": @"glyphs", @"fontStacks": @[]},
		@{@"url": self.glyph[@"url"], @"scope": @"glyph", @"template": @"glyphs", @"fontStacks": @[@"Noto/Other"]}
	]) XCTAssertThrows([[TFAdmissionCatalog alloc] initWithResources:@[resource]]);
	NSMutableArray *overflow = [NSMutableArray array];
	for (NSUInteger index = 0; index < 129; index++) [overflow addObject:@{@"url": [NSString stringWithFormat:@"https://assets.example.test/%lu.png", (unsigned long)index], @"scope": @"sprite"}];
	XCTAssertThrows([[TFAdmissionCatalog alloc] initWithResources:overflow]);
	XCTAssertEqualObjects(catalog.description, @"TFAdmissionCatalog(redacted)");
}
@end
