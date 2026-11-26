plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "net.mioyi.weftui.app"
    compileSdk = 37
    defaultConfig {
        applicationId = "net.mioyi.weftui.showcase"
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    // The generated views, with the Weft shell and Compose.
    implementation(project(":weft"))
    implementation("androidx.activity:activity-compose:1.13.0")

    androidTestImplementation("androidx.compose.ui:ui-test-junit4:1.12.1")
    // The Espresso that ui-test-junit4 brings injects input through APIs newer Android releases removed.
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest:1.12.1")
}
