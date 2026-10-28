// Runs the React Native package's JVM unit tests without a React Native application. The package
// normally builds inside an app next to MapLibre React Native, whose Gradle project needs React
// Native codegen. Only the surface module and the package registration use that project, so they
// are left out here; their compilation remains covered by the application build.
plugins {
    id("com.android.library") version "8.11.1"
    id("org.jetbrains.kotlin.android") version "2.2.20"
}

val library = file("../../packages/react-native/android/src")

android {
    namespace = "dev.tileflow.reactnative"
    compileSdk = 36
    defaultConfig { minSdk = 24 }
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
        getByName("test") { java.srcDir(library.resolve("test/java")) }
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

kotlin { jvmToolchain(17) }

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    exclude("**/TileflowNativeSurfaceModule.kt", "**/TileflowNativeAdmissionPackage.kt")
}

dependencies {
    implementation("com.facebook.react:react-android:0.83.10")
    implementation("org.maplibre.gl:android-sdk-opengl:13.6.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
