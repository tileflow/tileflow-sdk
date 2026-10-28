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
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.3")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.robolectric:robolectric:4.14.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.activity:activity:1.10.1")
}

// Coordinates, POM and the local candidate repository: platforms/native-release.json.
apply(from = rootProject.file("gradle/publishing.gradle.kts"))
