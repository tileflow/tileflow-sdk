#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@class TFNativeDocumentScope;
@class TileflowNativeDocuments;

@interface TileflowNativeAdmission : RCTEventEmitter <RCTBridgeModule>
- (TFNativeDocumentScope *)documentScopeForInstallation:(NSString *)installation context:(NSString *)context documents:(TileflowNativeDocuments *)documents;
@end
