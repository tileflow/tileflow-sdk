#import "TFAdmissionCatalog.h"
#import "TFAdmissionEngine.h"
#import <cmath>

static void TFCatalogInvalid(void) {
	@throw [NSException exceptionWithName:@"TFAdmissionCatalogInvalid" reason:@"Invalid native resource catalog" userInfo:nil];
}
static BOOL TFText(id value, NSUInteger maximum) {
	return [value isKindOfClass:NSString.class] && [(NSString *)value length] > 0 && [(NSString *)value length] <= maximum;
}
static NSRegularExpression *TFPattern(NSString *pattern) {
	NSRegularExpression *result = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
	if (!result) TFCatalogInvalid();
	return result;
}
static BOOL TFMatches(NSString *pattern, NSString *value) {
	return [TFPattern(pattern) numberOfMatchesInString:value options:0 range:NSMakeRange(0, value.length)] == 1;
}
static NSDictionary<NSString *, NSString *> *TFSlots(void) {
	NSString *decimal = @"(?:0|[1-9][0-9]{0,9})";
	NSString *coordinate = @"-?(?:0|[1-9][0-9]{0,7})(?:\\.[0-9]{1,16})?";
	return @{
		@"z": @"(?:0|[1-9][0-9]?)", @"x": decimal, @"y": decimal,
		@"ratio": @"(?:@2x|@3x)?", @"quadkey": @"[0-3]{0,30}", @"prefix": @"[0-9a-f]{2}",
		@"bbox-epsg-3857": [@[coordinate, coordinate, coordinate, coordinate] componentsJoinedByString:@","],
		@"fontstack": @"(?:[A-Za-z0-9_.~,+-]|%[0-9a-fA-F]{2}){1,768}",
		@"range": [NSString stringWithFormat:@"%@-%@", decimal, decimal]
	};
}

@interface TFAdmissionCatalogRule : NSObject
@property (nonatomic, copy) NSDictionary *resource;
@property (nonatomic, nullable) NSRegularExpression *pattern;
@property (nonatomic, copy) NSArray<NSString *> *names;
@end
@implementation TFAdmissionCatalogRule
- (NSString *)description { return @"TFAdmissionCatalogRule(redacted)"; }
@end

static TFAdmissionCatalogRule *TFRule(NSDictionary *input) {
	if (![input isKindOfClass:NSDictionary.class] || input.count > 5 || !TFText(input[@"url"], 1920) ||
		![@[@"style", @"tilejson", @"tile", @"sprite", @"glyph", @"font"] containsObject:input[@"scope"]]) TFCatalogInvalid();
	NSString *url = [input[@"url"] copy], *scope = [input[@"scope"] copy];
	NSString *tileset = input[@"tilesetId"], *family = input[@"template"];
	if (([scope isEqual:@"tile"] || [scope isEqual:@"tilejson"]) && !tileset) TFCatalogInvalid();
	if (tileset && (!TFText(tileset, 255) || !TFMatches(@"\\A[A-Za-z0-9._:-]{1,255}\\z", tileset) ||
		[tileset.lowercaseString containsString:@"tf_native_"] || [tileset.lowercaseString containsString:@"tf_public_"])) TFCatalogInvalid();
	NSMutableDictionary *resource = [@{@"url": url, @"scope": scope} mutableCopy];
	if (tileset) resource[@"tilesetId"] = [tileset copy];
	TFAdmissionCatalogRule *rule = [TFAdmissionCatalogRule new];
	if (!family) {
		if (input[@"fontStacks"] || [url containsString:@"{"] || [url containsString:@"}"]) TFCatalogInvalid();
		TFAdmissionCleanURL(url);
		rule.resource = [resource copy]; rule.names = @[];
		return rule;
	}
	if (![@[@"tile", @"glyphs"] containsObject:family] || ![url hasPrefix:@"https://"]) TFCatalogInvalid();
	NSRange path = [url rangeOfString:@"/" options:0 range:NSMakeRange(8, url.length - 8)];
	if (path.location == NSNotFound || [[url substringToIndex:path.location] rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"{}"]].location != NSNotFound) TFCatalogInvalid();
	NSRegularExpression *placeholder = TFPattern(@"\\{([a-z0-9-]+)\\}");
	NSArray<NSTextCheckingResult *> *matches = [placeholder matchesInString:url options:0 range:NSMakeRange(0, url.length)];
	if (!matches.count || matches.count > 16) TFCatalogInvalid();
	NSString *masked = [placeholder stringByReplacingMatchesInString:url options:0 range:NSMakeRange(0, url.length) withTemplate:@"native-template-slot"];
	if ([masked containsString:@"{"] || [masked containsString:@"}"]) TFCatalogInvalid();
	TFAdmissionCleanURL(masked);
	NSMutableArray<NSString *> *names = [NSMutableArray array];
	NSMutableString *pattern = [NSMutableString stringWithString:@"\\A"];
	NSDictionary *slots = TFSlots();
	NSUInteger cursor = 0;
	for (NSTextCheckingResult *match in matches) {
		NSString *name = [url substringWithRange:[match rangeAtIndex:1]];
		if (!slots[name] || (names.count && match.range.location == cursor)) TFCatalogInvalid();
		BOOL glyphSlot = [name isEqual:@"fontstack"] || [name isEqual:@"range"];
		if ([family isEqual:@"glyphs"] != glyphSlot) TFCatalogInvalid();
		[pattern appendString:[NSRegularExpression escapedPatternForString:[url substringWithRange:NSMakeRange(cursor, match.range.location - cursor)]]];
		[pattern appendFormat:@"(%@)", slots[name]];
		[names addObject:name]; cursor = NSMaxRange(match.range);
	}
	[pattern appendString:[NSRegularExpression escapedPatternForString:[url substringFromIndex:cursor]]];
	[pattern appendString:@"\\z"];
	if ([family isEqual:@"tile"]) {
		if (![scope isEqual:@"tile"] || input[@"fontStacks"]) TFCatalogInvalid();
	} else {
		NSArray *stacks = input[@"fontStacks"];
		if (![scope isEqual:@"glyph"] || ![names containsObject:@"fontstack"] || ![names containsObject:@"range"] ||
			![stacks isKindOfClass:NSArray.class] || !stacks.count || stacks.count > 16) TFCatalogInvalid();
		NSMutableArray *snapshot = [NSMutableArray array];
		for (NSString *stack in stacks) {
			if (!TFText(stack, 256) || [snapshot containsObject:stack] ||
				![stack isEqual:[stack stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]] ||
				[stack rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location != NSNotFound ||
				[stack rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"\\/?#%&="]].location != NSNotFound ||
				[stack.lowercaseString containsString:@"tf_native_"] || [stack.lowercaseString containsString:@"tf_public_"]) TFCatalogInvalid();
			for (NSString *part in [stack componentsSeparatedByString:@","]) {
				if (!part.length || ![part isEqual:[part stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]]) TFCatalogInvalid();
			}
			[snapshot addObject:[stack copy]];
		}
		resource[@"fontStacks"] = [snapshot copy];
	}
	resource[@"template"] = [family copy];
	rule.resource = [resource copy]; rule.pattern = TFPattern(pattern); rule.names = [names copy];
	return rule;
}

static BOOL TFRuleMatches(TFAdmissionCatalogRule *rule, NSString *url) {
	if (!rule.pattern) return [rule.resource[@"url"] isEqual:url];
	NSTextCheckingResult *match = [rule.pattern firstMatchInString:url options:0 range:NSMakeRange(0, url.length)];
	if (!match) return NO;
	NSMutableDictionary<NSString *, NSString *> *values = [NSMutableDictionary dictionary];
	for (NSUInteger index = 0; index < rule.names.count; index++) {
		NSString *name = rule.names[index], *value = [url substringWithRange:[match rangeAtIndex:index + 1]];
		if (values[name] && ![values[name] isEqual:value]) return NO;
		values[name] = value;
	}
	NSUInteger zoom = values[@"z"] ? [values[@"z"] integerValue] : 30;
	if (zoom > 30) return NO;
	for (NSString *name in @[@"x", @"y"]) if (values[name] && [values[name] longLongValue] >= (1LL << zoom)) return NO;
	if (values[@"quadkey"] && values[@"z"] && values[@"quadkey"].length != zoom) return NO;
	if (values[@"bbox-epsg-3857"]) {
		NSArray *numbers = [values[@"bbox-epsg-3857"] componentsSeparatedByString:@","];
		for (NSString *number in numbers) if (!std::isfinite(number.doubleValue) || std::abs(number.doubleValue) > 20037508.343) return NO;
		if ([numbers[0] doubleValue] >= [numbers[2] doubleValue] || [numbers[1] doubleValue] >= [numbers[3] doubleValue]) return NO;
	}
	if (values[@"range"]) {
		NSArray *pair = [values[@"range"] componentsSeparatedByString:@"-"];
		long long start = [pair[0] longLongValue], end = [pair[1] longLongValue];
		if (start % 256 != 0 || end != start + 255 || end > 1114111) return NO;
	}
	if (values[@"fontstack"]) {
		NSString *stack = values[@"fontstack"].stringByRemovingPercentEncoding;
		if (!stack || ![rule.resource[@"fontStacks"] containsObject:stack]) return NO;
	}
	return YES;
}

static NSDictionary *TFMergeExtension(NSDictionary *previous, NSDictionary *next) {
	if ([previous isEqual:next]) return previous;
	if (![previous[@"scope"] isEqual:next[@"scope"]] ||
		!((previous[@"tilesetId"] == nil && next[@"tilesetId"] == nil) || [previous[@"tilesetId"] isEqual:next[@"tilesetId"]]) ||
		!((previous[@"template"] == nil && next[@"template"] == nil) || [previous[@"template"] isEqual:next[@"template"]]) ||
		![previous[@"scope"] isEqual:@"glyph"] || ![previous[@"template"] isEqual:@"glyphs"]) TFCatalogInvalid();
	NSArray *before = previous[@"fontStacks"], *after = next[@"fontStacks"];
	if (![before isKindOfClass:NSArray.class] || ![after isKindOfClass:NSArray.class] || after.count > 16) TFCatalogInvalid();
	for (NSString *stack in before) if (![after containsObject:stack]) TFCatalogInvalid();
	return next;
}

@interface TFAdmissionCatalog ()
@property (nonatomic, readwrite, copy) NSDictionary<NSString *, NSDictionary *> *resources;
@property (nonatomic, copy) NSArray<TFAdmissionCatalogRule *> *rules;
@end
@implementation TFAdmissionCatalog
- (instancetype)initWithResources:(NSArray<NSDictionary *> *)resources {
	if ((self = [super init])) {
		@try {
			if (![resources isKindOfClass:NSArray.class] || resources.count > 128) TFCatalogInvalid();
			NSMutableDictionary *snapshots = [NSMutableDictionary dictionary];
			NSMutableArray *rules = [NSMutableArray array];
			for (NSDictionary *resource in resources) {
				TFAdmissionCatalogRule *rule = TFRule(resource);
				NSString *url = rule.resource[@"url"];
				if (snapshots[url]) TFCatalogInvalid();
				snapshots[url] = rule.resource; [rules addObject:rule];
			}
			_resources = [snapshots copy]; _rules = [rules copy];
		} @catch (NSException *exception) { TFCatalogInvalid(); }
	}
	return self;
}
- (TFAdmissionCatalog *)extending:(NSArray<NSDictionary *> *)resources {
	TFAdmissionCatalog *incoming = [[TFAdmissionCatalog alloc] initWithResources:resources];
	NSMutableDictionary *merged = [self.resources mutableCopy];
	for (NSString *url in incoming.resources) {
		NSDictionary *resource = incoming.resources[url];
		merged[url] = merged[url] ? TFMergeExtension(merged[url], resource) : resource;
	}
	return [[TFAdmissionCatalog alloc] initWithResources:merged.allValues];
}
- (NSDictionary *)find:(NSString *)url {
	@try { TFAdmissionCleanURL(url); } @catch (NSException *exception) { return nil; }
	NSDictionary *found = nil;
	for (TFAdmissionCatalogRule *rule in self.rules) {
		if (!TFRuleMatches(rule, url)) continue;
		if (found) TFCatalogInvalid();
		NSMutableDictionary *identity = [@{@"url": url, @"scope": rule.resource[@"scope"]} mutableCopy];
		if (rule.resource[@"tilesetId"]) identity[@"tilesetId"] = rule.resource[@"tilesetId"];
		found = [identity copy];
	}
	return found;
}
- (NSString *)description { return @"TFAdmissionCatalog(redacted)"; }
@end
