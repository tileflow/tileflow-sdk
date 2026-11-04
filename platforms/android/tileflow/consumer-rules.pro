# The SDK's WebView bridge uses AndroidX WebMessageListener, not reflective Java interfaces.
# The default location provider uses Google Play services' Fused Location Provider only when the
# application includes play-services-location; without it, its references are never loaded.
-dontwarn com.google.android.gms.common.**
-dontwarn com.google.android.gms.location.**
-dontwarn com.google.android.gms.tasks.**

# Runtime style JSON reads MapLibre's generated accessors by their style-spec names.
-keepclassmembers class org.maplibre.android.style.layers.** extends org.maplibre.android.style.layers.Layer {
    public org.maplibre.android.style.layers.PropertyValue get*();
    public void set*Transition(org.maplibre.android.style.layers.TransitionOptions);
    public void setSourceLayer(java.lang.String);
    public void setFilter(org.maplibre.android.style.expressions.Expression);
    public org.maplibre.android.style.expressions.Expression getFilter();
}
-keepclassmembers class org.maplibre.android.style.layers.Layer {
    public org.maplibre.android.style.layers.PropertyValue getVisibility();
}
