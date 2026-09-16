#import "TFAdmissionEngine.h"

NSString *const TFAdmissionGrantHeader = @"X-Tileflow-Native-Grant";

static void TFInvalidURL(void) {
	@throw [NSException exceptionWithName:@"TFNativeAdmissionInvalid" reason:@"Invalid native resource" userInfo:nil];
}
static BOOL TFMatches(NSString *value, NSString *pattern) {
	if (![value isKindOfClass:NSString.class]) return NO;
	NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
	return [expression numberOfMatchesInString:value options:0 range:NSMakeRange(0, value.length)] == 1;
}
static NSString *TFDecodeKey(NSString *value) {
	NSMutableString *decoded = [NSMutableString string];
	for (NSUInteger index = 0; index < value.length; index++) {
		unichar character = [value characterAtIndex:index];
		if (character == '%' && index + 2 < value.length) {
			NSString *hex = [value substringWithRange:NSMakeRange(index + 1, 2)];
			if (TFMatches(hex, @"^[0-9a-fA-F]{2}$")) {
				unsigned int byte = 0;
				[[NSScanner scannerWithString:hex] scanHexInt:&byte];
				[decoded appendFormat:@"%C", (unichar)byte];
				index += 2;
				continue;
			}
		}
		[decoded appendFormat:@"%C", character];
	}
	return decoded;
}
BOOL TFAdmissionValidToken(id value) {
	return [value isKindOfClass:NSString.class] && TFMatches(value, @"^[A-Za-z0-9_.-]{1,96}$") && ![value hasPrefix:@"tf_"];
}
BOOL TFAdmissionHasReservedContext(NSString *url) {
	if (![url isKindOfClass:NSString.class]) return NO;
	NSRange query = [url rangeOfString:@"?"];
	if (query.location == NSNotFound) return NO;
	for (NSString *part in [[url substringFromIndex:query.location + 1] componentsSeparatedByString:@"&"]) {
		NSString *key = [part componentsSeparatedByString:@"="].firstObject;
		if ([TFDecodeKey(key).lowercaseString hasPrefix:@"__tf_native"]) return YES;
	}
	return NO;
}
NSString *TFAdmissionOrigin(NSString *url) {
	NSURLComponents *components = [NSURLComponents componentsWithString:url];
	if (![components.scheme isEqual:@"https"] || !components.host.length || components.user != nil || components.password != nil) TFInvalidURL();
	NSString *host = components.host.lowercaseString;
	if ([host containsString:@":"] && ![host hasPrefix:@"["]) host = [NSString stringWithFormat:@"[%@]", host];
	NSNumber *port = components.port;
	if (port && (port.integerValue < 1 || port.integerValue > 65535)) TFInvalidURL();
	return [NSString stringWithFormat:@"https://%@%@", host, port && port.integerValue != 443 ? [NSString stringWithFormat:@":%@", port] : @""];
}
NSString *TFAdmissionCleanURL(NSString *url) {
	if (![url isKindOfClass:NSString.class] || url.length > 2048 || !TFMatches(url, @"^[\\x21-\\x7e]+$") || [url containsString:@"\\"] || [url containsString:@"#"] || TFAdmissionHasReservedContext(url)) TFInvalidURL();
	NSURLComponents *components = [NSURLComponents componentsWithString:url];
	NSString *origin = TFAdmissionOrigin(url);
	if (![url hasPrefix:[origin stringByAppendingString:@"/"]] || ![components.URL.absoluteString isEqual:url]) TFInvalidURL();
	for (NSString *segment in [components.percentEncodedPath componentsSeparatedByString:@"/"]) {
		NSString *decoded = TFDecodeKey(segment);
		if ([decoded isEqual:@"."] || [decoded isEqual:@".."]) TFInvalidURL();
	}
	NSString *decoded = TFDecodeKey(url).lowercaseString;
	if ([decoded containsString:@"tf_native_"] || [decoded containsString:@"tf_public_"]) TFInvalidURL();
	return url;
}
NSDictionary<NSString *, NSString *> *TFAdmissionStripContext(NSString *url) {
	if (![url isKindOfClass:NSString.class] || url.length > 2048 || [url containsString:@"#"] || [url containsString:@"\\"]) TFInvalidURL();
	NSRange query = [url rangeOfString:@"?"];
	if (query.location == NSNotFound) TFInvalidURL();
	NSArray<NSString *> *parts = [[url substringFromIndex:query.location + 1] componentsSeparatedByString:@"&"];
	NSMutableArray<NSString *> *remaining = [NSMutableArray array];
	NSString *context = nil;
	for (NSString *part in parts) {
		NSString *key = [part componentsSeparatedByString:@"="].firstObject;
		if ([TFDecodeKey(key).lowercaseString hasPrefix:@"__tf_native"]) {
			if (context || ![part hasPrefix:@"__tf_native_context="]) TFInvalidURL();
			context = [part substringFromIndex:@"__tf_native_context=".length];
			if (!TFAdmissionValidToken(context)) TFInvalidURL();
		} else [remaining addObject:part];
	}
	if (!context) TFInvalidURL();
	NSString *clean = [[url substringToIndex:query.location] stringByAppendingString:remaining.count ? [@"?" stringByAppendingString:[remaining componentsJoinedByString:@"&"]] : @""];
	return @{@"context": context, @"url": TFAdmissionCleanURL(clean)};
}
NSError *TFAdmissionSafeError(void) {
	return [NSError errorWithDomain:@"TileflowNativeAdmission" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Native resource admission failed"}];
}
