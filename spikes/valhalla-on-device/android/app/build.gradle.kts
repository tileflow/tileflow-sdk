// Measurement app. Flavour `valhalla` packages the prebuilt libtf_valhalla.so (copied into
// ../.build/jniLibs by scripts/android-app.sh); `baseline` is the same app without it.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.tileflow.spike.valhalla"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.tileflow.spike.valhalla"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1"
        ndk { abiFilters += "arm64-v8a" }
    }
    flavorDimensions += "engine"
    productFlavors {
        create("valhalla") { dimension = "engine" }
        create("baseline") {
            dimension = "engine"
            applicationIdSuffix = ".baseline"
        }
    }
    sourceSets["valhalla"].jniLibs.srcDirs("../../.build/jniLibs")
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin { jvmToolchain(17) }
}
