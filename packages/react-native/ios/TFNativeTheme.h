#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// Pure helpers for theme transitions and blends on MapLibre iOS. UI-queue use only where noted.

/** The projective transform taking four points to four points (h[8] = 1), or NO when degenerate. */
FOUNDATION_EXPORT BOOL TFThemeHomography(const CGPoint from[_Nonnull 4], const CGPoint to[_Nonnull 4], double h[_Nonnull 9]);
/** A homography as a layer transform for anchor point (0, 0). */
FOUNDATION_EXPORT CATransform3D TFThemeTransform(const double h[_Nonnull 9]);
/** The MapLibre iOS key of a style-specification layer property. */
FOUNDATION_EXPORT NSString *TFThemeStyleKey(NSString *property);
/** A hex, rgb(a), hsl(a), or transparent colour, or nil. */
FOUNDATION_EXPORT UIColor *_Nullable TFThemeColor(NSString *text);
/** Whether every element is a number (not a boolean). */
FOUNDATION_EXPORT BOOL TFThemeNumbers(NSArray *array);
/** Whether a value can be set at run time: constants and expressions that read no feature data. */
FOUNDATION_EXPORT BOOL TFThemeCameraValue(id _Nullable value, NSUInteger depth);
/**
 * A style-specification value as the expression MapLibre iOS expects for `key`; nil resets it.
 * `supported` is NO, with nil, for a value MapLibre iOS cannot take at run time.
 */
FOUNDATION_EXPORT NSExpression *_Nullable TFThemeExpression(id _Nullable value, NSString *key, BOOL *supported);
/** Pattern artwork mixed in premultiplied pixels: `from` at 1 - t plus `to` at t. */
FOUNDATION_EXPORT UIImage *TFThemeMixImage(UIImage *from, UIImage *to, double t);

NS_ASSUME_NONNULL_END
