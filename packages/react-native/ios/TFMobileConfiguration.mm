#import "TFMobileConfiguration.h"

static NSError *TFMobileConfigurationFailure(void) {
	return [NSError errorWithDomain:@"TileflowNativeConfiguration" code:1 userInfo:@{
		NSLocalizedDescriptionKey: @"Native application configuration is invalid."
	}];
}

static BOOL TFMobileMatches(NSString *value, NSString *pattern) {
	NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
	NSTextCheckingResult *match = [expression firstMatchInString:value options:0 range:NSMakeRange(0, value.length)];
	return match != nil && NSEqualRanges(match.range, NSMakeRange(0, value.length));
}

/** Keep this narrow lexical grammar identical to MobileConfiguration.kt and mobile-configuration.ts. */
static NSString *TFMobileOrigin(NSString *value) {
	if (value.length == 0 || value.length > 2048) return nil;
	NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:
		@"\\A[Hh][Tt][Tt][Pp][Ss]://([A-Za-z0-9.-]+)(?::([1-9][0-9]{0,4}))?/?\\z" options:0 error:nil];
	NSTextCheckingResult *match = [expression firstMatchInString:value options:0 range:NSMakeRange(0, value.length)];
	if (!match || !NSEqualRanges(match.range, NSMakeRange(0, value.length))) return nil;
	NSString *host = [[value substringWithRange:[match rangeAtIndex:1]] lowercaseString];
	NSArray<NSString *> *labels = [host componentsSeparatedByString:@"."];
	if (host.length > 253) return nil;
	for (NSString *label in labels) {
		if (!TFMobileMatches(label, @"\\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\z")) return nil;
	}
	unichar first = [labels.lastObject characterAtIndex:0];
	if (first < 'a' || first > 'z') {
		if (labels.count != 4) return nil;
		for (NSString *label in labels) {
			if (!TFMobileMatches(label, @"\\A(?:0|[1-9][0-9]{0,2})\\z") || label.integerValue > 255) return nil;
		}
	}
	NSRange portRange = [match rangeAtIndex:2];
	NSInteger port = portRange.location == NSNotFound ? 443 : [value substringWithRange:portRange].integerValue;
	if (port > 65535) return nil;
	return port == 443 ? [@"https://" stringByAppendingString:host] : [NSString stringWithFormat:@"https://%@:%ld", host, (long)port];
}

@interface TFMobileConfiguration ()
- (instancetype)initWithOrigin:(NSString *)origin credential:(NSString *)credential;
@end

@implementation TFMobileConfiguration
- (instancetype)initWithOrigin:(NSString *)origin credential:(NSString *)credential {
	if ((self = [super init])) {
		_apiOrigin = [origin copy];
		_credential = [credential copy];
	}
	return self;
}
- (NSString *)description { return @"TFMobileConfiguration"; }
- (NSString *)debugDescription { return @"TFMobileConfiguration"; }

+ (instancetype)parse:(id)input error:(NSError **)error {
	if (error) *error = nil;
	@try {
		if (![input isKindOfClass:NSArray.class] || [input count] != 2) {
			if (error) *error = TFMobileConfigurationFailure();
			return nil;
		}
		NSString *origin = nil;
		NSString *credential = nil;
		for (id item in (NSArray *)input) {
			if (![item isKindOfClass:NSString.class] || [item length] > 2080) {
				if (error) *error = TFMobileConfigurationFailure();
				return nil;
			}
			NSString *text = item;
			NSRange separator = [text rangeOfString:@"="];
			if (separator.location == NSNotFound || separator.location == 0) {
				if (error) *error = TFMobileConfigurationFailure();
				return nil;
			}
			NSString *key = [text substringToIndex:separator.location];
			NSString *value = [text substringFromIndex:separator.location + 1];
			if ([key isEqualToString:@"apiOrigin"] && !origin) {
				origin = TFMobileOrigin(value);
				if (origin) continue;
			} else if ([key isEqualToString:@"credential"] && !credential) {
				if (value.length == 58 && TFMobileMatches(value, @"\\Atf_public_[0-9a-f]{48}\\z")) {
					credential = [value copy];
					continue;
				}
			}
			// Missing, repeated, unknown or malformed fields have the same safe failure.
			if (error) *error = TFMobileConfigurationFailure();
			return nil;
		}
		if (origin && credential) return [[self alloc] initWithOrigin:origin credential:credential];
	} @catch (NSException *exception) {
		// Do not inspect or forward an exception that could contain a configured value.
		(void)exception;
	}
	if (error) *error = TFMobileConfigurationFailure();
	return nil;
}

+ (instancetype)fromInfo:(NSDictionary *)info localized:(NSDictionary *)localized error:(NSError **)error {
	if (error) *error = nil;
	@try {
		if ([info isKindOfClass:NSDictionary.class] &&
			(!localized || [localized isKindOfClass:NSDictionary.class]) &&
			!localized[@"TileflowMobileConfiguration"]) {
			return [self parse:info[@"TileflowMobileConfiguration"] error:error];
		}
	} @catch (NSException *exception) { (void)exception; }
	if (error) *error = TFMobileConfigurationFailure();
	return nil;
}
@end

@implementation TFMobileConfigurationCache {
	NSInteger _phase;
	TFMobileConfiguration *_configuration;
}
- (TFMobileConfiguration *)read:(TFMobileConfiguration *(^)(void))source error:(NSError **)error {
	if (error) *error = nil;
	@synchronized (self) {
		if (_phase == 2) return _configuration;
		if (_phase == 0) {
			_phase = 1;
			@try {
				TFMobileConfiguration *value = source();
				if (value && _phase == 1) {
					_configuration = value;
					_phase = 2;
					return value;
				}
			} @catch (NSException *exception) { (void)exception; }
		}
		_phase = 3;
		_configuration = nil;
		if (error) *error = TFMobileConfigurationFailure();
		return nil;
	}
}
@end
