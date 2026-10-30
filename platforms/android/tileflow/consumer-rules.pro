# The SDK's WebView bridge uses AndroidX WebMessageListener, not reflective Java interfaces.
# The default location provider uses Google Play services' Fused Location Provider only when the
# application includes play-services-location; without it, its references are never loaded.
-dontwarn com.google.android.gms.common.**
-dontwarn com.google.android.gms.location.**
-dontwarn com.google.android.gms.tasks.**
