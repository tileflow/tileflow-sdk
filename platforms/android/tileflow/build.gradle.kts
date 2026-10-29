plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.dokka")
    id("maven-publish")
}

android {
    namespace = "dev.tileflow.sdk"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
    testOptions {
        targetSdk = 36
        unitTests.isIncludeAndroidResources = true
    }
    // The offline fixtures are shared with the Swift tests.
    sourceSets["test"].resources.srcDir("../../ios/Tests/TileflowTests/Fixtures/Offline")
    publishing { singleVariant("release") { withSourcesJar() } }
}

kotlin { jvmToolchain(17) }

dependencies {
    api(project(":tileflow-configuration"))
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    api(platform("androidx.compose:compose-bom:2025.08.01"))
    api("androidx.compose.ui:ui")
    api("androidx.compose.runtime:runtime")
    // PaddingValues for a map's content padding.
    api("androidx.compose.foundation:foundation-layout")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.3")
    // Offline regions download as background work that survives the process.
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("androidx.work:work-testing:2.10.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.activity:activity:1.10.1")
}

// Coordinates, POM and the local candidate repository: platforms/native-release.json.
apply(from = rootProject.file("gradle/publishing.gradle.kts"))
