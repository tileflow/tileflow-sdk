plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.tileflow.measure"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.tileflow.measure"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        ndk { abiFilters.add("arm64-v8a") }
    }

    flavorDimensions += "content"
    productFlavors {
        create("empty") {
            dimension = "content"
            applicationIdSuffix = ".empty"
        }
        create("mapsx") {
            dimension = "content"
            applicationIdSuffix = ".mapsx"
        }
        create("servs") {
            dimension = "content"
            applicationIdSuffix = ".servs"
        }
    }
    sourceSets["mapsx"].java.srcDir("src/mapShared/java")
    sourceSets["servs"].java.srcDir("src/mapShared/java")

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs["debug"]
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    for (flavor in listOf("mapsx", "servs")) {
        add("${flavor}Implementation", project(":tileflow"))
        add("${flavor}CompileOnly", "org.maplibre.gl:android-sdk-opengl:13.7.1")
        add("${flavor}Implementation", "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    }
    add("servsImplementation", project(":tileflow-services"))
}
