#import <XCTest/XCTest.h>
#import <MapLibre/MapLibre.h>
#import "TFNativeTheme.h"

@interface TFNativeThemeTests : XCTestCase
@end
@implementation TFNativeThemeTests
- (void)assertColour:(UIColor *)colour red:(CGFloat)red green:(CGFloat)green blue:(CGFloat)blue alpha:(CGFloat)alpha {
	CGFloat r, g, b, a;
	XCTAssertTrue([colour getRed:&r green:&g blue:&b alpha:&a]);
	XCTAssertEqualWithAccuracy(r, red, 0.002); XCTAssertEqualWithAccuracy(g, green, 0.002);
	XCTAssertEqualWithAccuracy(b, blue, 0.002); XCTAssertEqualWithAccuracy(a, alpha, 0.002);
}
- (void)testStyleKeysFollowMapLibreNamesAndCamelCaseOtherwise {
	XCTAssertEqualObjects(TFThemeStyleKey(@"fill-color"), @"fillColor");
	XCTAssertEqualObjects(TFThemeStyleKey(@"fill-extrusion-opacity"), @"fillExtrusionOpacity");
	XCTAssertEqualObjects(TFThemeStyleKey(@"line-dasharray"), @"lineDashPattern");
	XCTAssertEqualObjects(TFThemeStyleKey(@"line-translate"), @"lineTranslation");
	XCTAssertEqualObjects(TFThemeStyleKey(@"icon-image"), @"iconImageName");
	XCTAssertEqualObjects(TFThemeStyleKey(@"text-field"), @"text");
	XCTAssertEqualObjects(TFThemeStyleKey(@"text-size"), @"textFontSize");
	XCTAssertEqualObjects(TFThemeStyleKey(@"raster-brightness-min"), @"minimumRasterBrightness");
}
- (void)testColoursParseHexFunctionalAndPercentageForms {
	[self assertColour:TFThemeColor(@"#ff8000") red:1 green:128 / 255.0 blue:0 alpha:1];
	[self assertColour:TFThemeColor(@"#f80") red:1 green:136 / 255.0 blue:0 alpha:1];
	[self assertColour:TFThemeColor(@"#ff800080") red:1 green:128 / 255.0 blue:0 alpha:128 / 255.0];
	[self assertColour:TFThemeColor(@"rgba(255, 128, 0, 0.5)") red:1 green:128 / 255.0 blue:0 alpha:0.5];
	[self assertColour:TFThemeColor(@"rgb(100% 50% 0%)") red:1 green:0.5 blue:0 alpha:1];
	[self assertColour:TFThemeColor(@"hsl(120, 100%, 25%)") red:0 green:0.5 blue:0 alpha:1];
	XCTAssertNil(TFThemeColor(@"tomato"));
	XCTAssertNil(TFThemeColor(@"rgba(1, 2)"));
	XCTAssertNil(TFThemeColor(@"#12345"));
}
- (void)testOnlyValuesThatReadNoFeatureDataAreSetAtRunTime {
	XCTAssertTrue(TFThemeCameraValue(@"#ffffff", 0));
	XCTAssertTrue(TFThemeCameraValue(@[@"interpolate", @[@"linear"], @[@"zoom"], @10, @"#000000", @14, @"#ffffff"], 0));
	XCTAssertTrue(TFThemeCameraValue(@[@"*", @[@"interpolate", @[@"linear"], @[@"zoom"], @8, @0, @9, @1], @0.4], 0));
	XCTAssertTrue(TFThemeCameraValue(@[@"literal", @[@"get", @"is", @"a", @"label"]], 0));
	XCTAssertFalse(TFThemeCameraValue(@[@"match", @[@"get", @"class"], @"park", @"#00ff00", @"#000000"], 0));
	XCTAssertFalse(TFThemeCameraValue(@[@"case", @[@"all", @[@"has", @"access"], @[@"!", @[@"has", @"gate"]]], @"#111111", @"#222222"], 0));
	XCTAssertFalse(TFThemeCameraValue(@[@"coalesce", @[@"feature-state", @"hover"], @"#000000"], 0));
}
- (void)testExpressionsUseTheTypesMapLibreExpects {
	BOOL supported;
	NSExpression *colour = TFThemeExpression(@"rgba(10, 20, 30, 0.4)", @"fillColor", &supported);
	XCTAssertTrue(supported);
	XCTAssertEqual(colour.expressionType, NSConstantValueExpressionType);
	XCTAssertTrue([colour.constantValue isKindOfClass:UIColor.class]);
	XCTAssertNil(TFThemeExpression(@"tomato", @"lineColor", &supported));
	XCTAssertFalse(supported, @"a colour name is left unchanged, not cast at run time");
	[self assertColour:TFThemeExpression(@"transparent", @"lineColor", &supported).constantValue red:0 green:0 blue:0 alpha:0];
	XCTAssertEqualObjects(TFThemeExpression(@0.5, @"fillOpacity", &supported).constantValue, @0.5);
	NSValue *vector = TFThemeExpression(@[@2, @-3], @"lineTranslation", &supported).constantValue;
	XCTAssertEqual(vector.CGVectorValue.dx, 2); XCTAssertEqual(vector.CGVectorValue.dy, -3);
	XCTAssertEqualObjects(TFThemeExpression(@[@2, @1], @"lineDashPattern", &supported).constantValue, (@[@2, @1]));
	XCTAssertEqualObjects(TFThemeExpression(@[@"Noto Sans Bold"], @"textFontNames", &supported).constantValue, (@[@"Noto Sans Bold"]));
	NSArray *curve = @[@"interpolate", @[@"linear"], @[@"zoom"], @10, @"#000000", @14, @"#ffffff"];
	XCTAssertEqualObjects(TFThemeExpression(curve, @"lineColor", &supported).mgl_jsonExpressionObject, curve);
	XCTAssertNil(TFThemeExpression(NSNull.null, @"lineColor", &supported));
	XCTAssertTrue(supported, @"null resets the property");
}
- (void)testHomographyMapsTheFourPointsAndBecomesALayerTransform {
	CGPoint from[4] = {{10, 45}, {90, 45}, {90, 90}, {10, 90}};
	CGPoint to[4] = {{20, 40}, {100, 50}, {80, 100}, {5, 85}};
	double h[9];
	XCTAssertTrue(TFThemeHomography(from, to, h));
	CATransform3D transform = TFThemeTransform(h);
	for (int index = 0; index < 4; index++) {
		double x = from[index].x, y = from[index].y;
		double w = x * transform.m14 + y * transform.m24 + transform.m44;
		XCTAssertEqualWithAccuracy((x * transform.m11 + y * transform.m21 + transform.m41) / w, to[index].x, 1e-6);
		XCTAssertEqualWithAccuracy((x * transform.m12 + y * transform.m22 + transform.m42) / w, to[index].y, 1e-6);
	}
	CGPoint line[4] = {{0, 0}, {1, 1}, {2, 2}, {3, 3}};
	XCTAssertFalse(TFThemeHomography(line, to, h));
}
- (void)testPatternArtworkMixesInPremultipliedPixels {
	UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat preferredFormat];
	format.scale = 2;
	UIImage *(^solid)(UIColor *) = ^UIImage *(UIColor *colour) {
		return [[[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(2, 2) format:format] imageWithActions:^(UIGraphicsImageRendererContext *context) {
			[colour setFill]; [context fillRect:CGRectMake(0, 0, 2, 2)];
		}];
	};
	UIImage *black = solid(UIColor.blackColor), *white = solid(UIColor.whiteColor);
	XCTAssertEqual(TFThemeMixImage(black, white, 0), black);
	XCTAssertEqual(TFThemeMixImage(black, white, 1), white);
	UIImage *mixed = TFThemeMixImage(black, white, 0.25);
	XCTAssertEqual(mixed.scale, 2);
	CGImageRef image = mixed.CGImage;
	uint8_t pixel[4] = {0};
	CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
	CGContextRef context = CGBitmapContextCreate(pixel, 1, 1, 8, 4, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
	CGContextDrawImage(context, CGRectMake(0, 0, 1, 1), image);
	CGContextRelease(context); CGColorSpaceRelease(space);
	XCTAssertEqualWithAccuracy(pixel[0], 64, 2); XCTAssertEqual(pixel[3], 255);
}
@end
