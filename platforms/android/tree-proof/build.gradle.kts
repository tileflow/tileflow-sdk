plugins { id("com.android.library") }

android {
    namespace = "dev.tileflow.treeproof"
    compileSdk = 36
    ndkVersion = "27.1.12297006"
    defaultConfig {
        minSdk = 26
        ndk { abiFilters += "arm64-v8a" }
        externalNativeBuild { cmake { arguments += "-DANDROID_STL=c++_static" } }
    }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }
}
