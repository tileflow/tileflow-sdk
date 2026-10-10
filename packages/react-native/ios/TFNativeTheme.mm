#import "TFNativeTheme.h"
#import <MapLibre/MapLibre.h>
#import <algorithm>
#import <cctype>
#import <cmath>

// The projective transform taking four points to four points (h[8] = 1), or NO when degenerate.
BOOL TFThemeHomography(const CGPoint from[4], const CGPoint to[4], double h[9]) {
	double rows[8][9];
	for (int i = 0; i < 4; i++) {
		double x = from[i].x, y = from[i].y, u = to[i].x, v = to[i].y;
		double first[9] = {x, y, 1, 0, 0, 0, -u * x, -u * y, u};
		double second[9] = {0, 0, 0, x, y, 1, -v * x, -v * y, v};
		for (int k = 0; k < 9; k++) { rows[2 * i][k] = first[k]; rows[2 * i + 1][k] = second[k]; }
	}
	for (int column = 0; column < 8; column++) {
		int pivot = column;
		for (int row = column + 1; row < 8; row++) if (std::fabs(rows[row][column]) > std::fabs(rows[pivot][column])) pivot = row;
		if (std::fabs(rows[pivot][column]) < 1e-12) return NO;
		if (pivot != column) for (int k = 0; k < 9; k++) std::swap(rows[pivot][k], rows[column][k]);
		for (int row = 0; row < 8; row++) {
			if (row == column) continue;
			double factor = rows[row][column] / rows[column][column];
			for (int k = column; k < 9; k++) rows[row][k] -= factor * rows[column][k];
		}
	}
	for (int i = 0; i < 8; i++) { h[i] = rows[i][8] / rows[i][i]; if (!std::isfinite(h[i])) return NO; }
	h[8] = 1;
	return YES;
}

// MapLibre iOS names layer properties after Cocoa conventions; everything else is camel case.
NSString *TFThemeStyleKey(NSString *property) {
	static NSDictionary<NSString *, NSString *> *renamed;
	static dispatch_once_t once;
	dispatch_once(&once, ^{
		renamed = @{
			@"circle-pitch-scale": @"circleScaleAlignment", @"circle-translate": @"circleTranslation", @"circle-translate-anchor": @"circleTranslationAnchor",
			@"fill-antialias": @"fillAntialiased", @"fill-translate": @"fillTranslation", @"fill-translate-anchor": @"fillTranslationAnchor",
			@"fill-extrusion-translate": @"fillExtrusionTranslation", @"fill-extrusion-translate-anchor": @"fillExtrusionTranslationAnchor",
			@"fill-extrusion-vertical-gradient": @"fillExtrusionHasVerticalGradient", @"icon-allow-overlap": @"iconAllowsOverlap",
			@"icon-ignore-placement": @"iconIgnoresPlacement", @"icon-image": @"iconImageName", @"icon-keep-upright": @"keepsIconUpright",
			@"icon-rotate": @"iconRotation", @"icon-size": @"iconScale", @"icon-translate": @"iconTranslation", @"icon-translate-anchor": @"iconTranslationAnchor",
			@"line-dasharray": @"lineDashPattern", @"line-translate": @"lineTranslation", @"line-translate-anchor": @"lineTranslationAnchor",
			@"raster-brightness-max": @"maximumRasterBrightness", @"raster-brightness-min": @"minimumRasterBrightness",
			@"raster-hue-rotate": @"rasterHueRotation", @"raster-resampling": @"rasterResamplingMode", @"symbol-avoid-edges": @"symbolAvoidsEdges",
			@"text-allow-overlap": @"textAllowsOverlap", @"text-field": @"text", @"text-font": @"textFontNames", @"text-ignore-placement": @"textIgnoresPlacement",
			@"text-justify": @"textJustification", @"text-keep-upright": @"keepsTextUpright", @"text-max-angle": @"maximumTextAngle",
			@"text-max-width": @"maximumTextWidth", @"text-rotate": @"textRotation", @"text-size": @"textFontSize", @"text-translate": @"textTranslation",
			@"text-translate-anchor": @"textTranslationAnchor", @"text-writing-mode": @"textWritingModes",
		};
	});
	NSString *key = renamed[property];
	if (key) return key;
	NSMutableString *camel = [NSMutableString string];
	BOOL upper = NO;
	for (NSUInteger index = 0; index < property.length; index++) {
		unichar character = [property characterAtIndex:index];
		if (character == '-') { upper = YES; continue; }
		[camel appendFormat:@"%C", upper ? (unichar)toupper(character) : character];
		upper = NO;
	}
	return camel;
}
static BOOL TFThemeChannel(NSString *text, double scale, double *out) {
	NSString *trimmed = [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
	BOOL percentage = [trimmed hasSuffix:@"%"];
	if (percentage) trimmed = [trimmed substringToIndex:trimmed.length - 1];
	NSScanner *scanner = [NSScanner scannerWithString:trimmed];
	double value;
	if (![scanner scanDouble:&value] || !scanner.isAtEnd || !std::isfinite(value)) return NO;
	*out = percentage ? value / 100.0 * scale : value;
	return YES;
}
// Hex, rgb(a), and hsl(a) colours; nil for anything else, which MapLibre then parses itself.
UIColor *TFThemeColor(NSString *text) {
	NSString *colour = [[text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet] lowercaseString];
	if ([colour isEqual:@"transparent"]) return [UIColor colorWithRed:0 green:0 blue:0 alpha:0];
	if ([colour hasPrefix:@"#"]) {
		NSString *hex = [colour substringFromIndex:1];
		if (hex.length == 3 || hex.length == 4) {
			NSMutableString *full = [NSMutableString string];
			for (NSUInteger index = 0; index < hex.length; index++) { unichar digit = [hex characterAtIndex:index]; [full appendFormat:@"%C%C", digit, digit]; }
			hex = full;
		}
		if (hex.length != 6 && hex.length != 8) return nil;
		unsigned long long number = 0;
		NSScanner *scanner = [NSScanner scannerWithString:hex];
		if (![scanner scanHexLongLong:&number] || !scanner.isAtEnd) return nil;
		if (hex.length == 6) number = (number << 8) | 0xff;
		return [UIColor colorWithRed:((number >> 24) & 0xff) / 255.0 green:((number >> 16) & 0xff) / 255.0 blue:((number >> 8) & 0xff) / 255.0 alpha:(number & 0xff) / 255.0];
	}
	NSRange open = [colour rangeOfString:@"("];
	if (open.location == NSNotFound || ![colour hasSuffix:@")"]) return nil;
	NSString *function = [colour substringToIndex:open.location];
	NSString *body = [colour substringWithRange:NSMakeRange(open.location + 1, colour.length - open.location - 2)];
	NSMutableArray<NSString *> *parts = [NSMutableArray array];
	for (NSString *part in [body componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@", /"]]) if (part.length) [parts addObject:part];
	if (parts.count < 3 || parts.count > 4) return nil;
	double alpha = 1;
	if (parts.count == 4 && !TFThemeChannel(parts[3], 1, &alpha)) return nil;
	if ([function isEqual:@"rgb"] || [function isEqual:@"rgba"]) {
		double red, green, blue;
		if (!TFThemeChannel(parts[0], 255, &red) || !TFThemeChannel(parts[1], 255, &green) || !TFThemeChannel(parts[2], 255, &blue)) return nil;
		return [UIColor colorWithRed:red / 255.0 green:green / 255.0 blue:blue / 255.0 alpha:alpha];
	}
	if ([function isEqual:@"hsl"] || [function isEqual:@"hsla"]) {
		double hue, saturation, lightness;
		if (!TFThemeChannel(parts[0], 1, &hue) || !TFThemeChannel(parts[1], 1, &saturation) || !TFThemeChannel(parts[2], 1, &lightness)) return nil;
		double chroma = (1 - std::fabs(2 * lightness - 1)) * saturation;
		double sector = std::fmod(std::fmod(hue, 360) + 360, 360) / 60;
		double x = chroma * (1 - std::fabs(std::fmod(sector, 2) - 1));
		double r = 0, g = 0, b = 0;
		if (sector < 1) { r = chroma; g = x; } else if (sector < 2) { r = x; g = chroma; } else if (sector < 3) { g = chroma; b = x; }
		else if (sector < 4) { g = x; b = chroma; } else if (sector < 5) { r = x; b = chroma; } else { r = chroma; b = x; }
		double offset = lightness - chroma / 2;
		return [UIColor colorWithRed:r + offset green:g + offset blue:b + offset alpha:alpha];
	}
	return nil;
}
BOOL TFThemeNumbers(NSArray *array) {
	for (id item in array) if (![item isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)item) == CFBooleanGetTypeID()) return NO;
	return YES;
}
// MapLibre iOS converts expressions through NSExpression, which cannot round-trip every expression
// that reads feature data or combines conditions. Blend plans set only camera values at run time;
// anything else is left unchanged rather than risked.
BOOL TFThemeCameraValue(id value, NSUInteger depth) {
	static NSSet<NSString *> *refused;
	static dispatch_once_t once;
	dispatch_once(&once, ^{
		refused = [NSSet setWithArray:@[@"!", @"!has", @"!in", @"accumulated", @"all", @"any", @"distance", @"feature-state", @"geometry-type",
			@"get", @"global-state", @"has", @"heatmap-density", @"id", @"in", @"line-progress", @"none", @"properties", @"within"]];
	});
	if (![value isKindOfClass:NSArray.class]) return YES;
	if (depth > 32) return NO;
	NSArray *array = value;
	if (array.count && [array[0] isKindOfClass:NSString.class]) {
		if ([refused containsObject:array[0]]) return NO;
		if ([array[0] isEqual:@"literal"]) return YES;
	}
	for (id item in array) if (!TFThemeCameraValue(item, depth + 1)) return NO;
	return YES;
}
// A style-specification value as the NSExpression MapLibre iOS expects for `key`; nil resets it.
NSExpression *TFThemeExpression(id value, NSString *key, BOOL *supported) {
	*supported = YES;
	if (!value || value == NSNull.null) return nil;
	if ([value isKindOfClass:NSString.class]) {
		if ([key hasSuffix:@"Color"]) {
			// MapLibre iOS cannot cast a colour name at run time; such a value is left unchanged.
			UIColor *colour = TFThemeColor(value);
			*supported = colour != nil;
			return colour ? [NSExpression expressionForConstantValue:colour] : nil;
		}
		return [NSExpression expressionForConstantValue:value];
	}
	if ([value isKindOfClass:NSNumber.class]) return [NSExpression expressionForConstantValue:value];
	if ([value isKindOfClass:NSArray.class]) {
		NSArray *array = value;
		if (array.count == 2 && TFThemeNumbers(array) && ([key hasSuffix:@"Translation"] || [key hasSuffix:@"Offset"]))
			return [NSExpression expressionForConstantValue:[NSValue valueWithCGVector:CGVectorMake([array[0] doubleValue], [array[1] doubleValue])]];
		if (TFThemeNumbers(array)) return [NSExpression expressionForConstantValue:array];
		BOOL strings = YES;
		for (id item in array) strings = strings && [item isKindOfClass:NSString.class];
		if (strings && [key isEqual:@"textFontNames"]) return [NSExpression expressionForConstantValue:array];
	}
	return [NSExpression expressionWithMLNJSONObject:value];
}
// Pattern artwork mixed in premultiplied pixels: `from` at 1 - t plus `to` at t.
UIImage *TFThemeMixImage(UIImage *from, UIImage *to, double t) {
	if (t <= 0) return from;
	if (t >= 1) return to;
	CGImageRef a = from.CGImage, b = to.CGImage;
	if (!a || !b || CGImageGetWidth(a) != CGImageGetWidth(b) || CGImageGetHeight(a) != CGImageGetHeight(b)) return t < 0.5 ? from : to;
	size_t width = CGImageGetWidth(a), height = CGImageGetHeight(a);
	CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
	CGContextRef context = CGBitmapContextCreate(NULL, width, height, 8, width * 4, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
	CGColorSpaceRelease(space);
	if (!context) return t < 0.5 ? from : to;
	CGRect rect = CGRectMake(0, 0, width, height);
	CGContextSetAlpha(context, 1 - t); CGContextDrawImage(context, rect, a);
	CGContextSetBlendMode(context, kCGBlendModePlusLighter); CGContextSetAlpha(context, t); CGContextDrawImage(context, rect, b);
	CGImageRef mixed = CGBitmapContextCreateImage(context);
	CGContextRelease(context);
	if (!mixed) return t < 0.5 ? from : to;
	UIImage *image = [UIImage imageWithCGImage:mixed scale:from.scale orientation:UIImageOrientationUp];
	CGImageRelease(mixed);
	return from.renderingMode == UIImageRenderingModeAlwaysTemplate ? [image imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate] : image;
}
// The homography as a layer transform for anchor point (0, 0): row vectors, perspective in m14/m24.
CATransform3D TFThemeTransform(const double h[9]) {
	CATransform3D transform = CATransform3DIdentity;
	transform.m11 = h[0]; transform.m12 = h[3]; transform.m14 = h[6];
	transform.m21 = h[1]; transform.m22 = h[4]; transform.m24 = h[7];
	transform.m41 = h[2]; transform.m42 = h[5]; transform.m44 = h[8];
	return transform;
}
