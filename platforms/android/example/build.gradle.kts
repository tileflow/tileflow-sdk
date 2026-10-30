plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "dev.tileflow.example"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.tileflow.example"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":tileflow"))
    implementation(project(":tileflow-configuration"))
    implementation(project(":tileflow-search"))
    implementation(project(":tileflow-routing"))
    implementation(project(":tileflow-service-content"))
    implementation("androidx.activity:activity-compose:1.10.1")
    // Activity result launchers registered by activities need Fragment 1.3 or later, which the
    // activity library alone does not bring.
    implementation("androidx.fragment:fragment-ktx:1.8.9")
    implementation(platform("androidx.compose:compose-bom:2025.08.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.3")
    // With Google Play services on the device, the SDK's default location provider uses the Fused
    // Location Provider; without this dependency it uses the platform's LocationManager.
    implementation("com.google.android.gms:play-services-location:21.3.0")
}
