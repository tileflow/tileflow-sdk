// JVM tests for the SDK-backed React Native mapper. Fabric delegates and TurboModule specs
// compile in the generated application consumer; the mapper uses the repository's native SDK.
plugins {
    id("com.android.library") version "8.11.1"
    id("org.jetbrains.kotlin.android") version "2.2.20"
}

val library = file("../../packages/react-native/android/src")

android {
    namespace = "dev.tileflow.reactnative"
    compileSdk = 36
    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets {
        getByName("main") {
            manifest.srcFile(library.resolve("main/AndroidManifest.xml"))
            java.srcDir(library.resolve("main/java"))
            res.srcDir(library.resolve("main/res"))
        }
        getByName("test") {
            java.srcDir(library.resolve("test/java"))
            // The shared bridge fixture and the services' contract fixture.
            resources.srcDir("../../packages/react-native/test/native")
            resources.srcDir("../../platforms/ios/Tests/TileflowServiceTests/Fixtures")
        }
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

kotlin { jvmToolchain(17) }

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    exclude(
        "**/TileflowMapModule.kt",
        "**/TileflowMapViewManager.kt",
        "**/TileflowMarkerViewManager.kt",
        "**/TileflowServicesModule.kt",
        "**/TileflowOfflineModule.kt",
        "**/TileflowReactNativePackage.kt",
    )
}

dependencies {
    implementation("com.facebook.react:react-android:0.83.10")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("dev.tileflow:tileflow")
    implementation("dev.tileflow:tileflow-services")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}
