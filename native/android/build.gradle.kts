// The Android shell of the Weft native kernel: runs the kernel (libweft.so,
// built by build-core.sh), applies its view protocol ops to the scopes of
// the Compose views that weft_ui_transformer::compose generates, and implements
// the platform modules. Included as the project :weft-android by the
// weft/settings.gradle.kts that @weft-ui/vite generates; plugin versions
// come from the app's root build.

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.plugin.compose")
}

// build/ holds the kernel libraries of build-core.sh, so the Gradle outputs
// go to the including app's build directory.
layout.buildDirectory.set(rootProject.layout.buildDirectory.dir("weft-android"))

android {
    namespace = "net.mioyi.weftui"
    compileSdk = 37
    defaultConfig {
        // Keep in sync with build-core.sh.
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
    }
    if (file("src/test").isDirectory) {
        testOptions.unitTests.all {
            it.systemProperty("weft.corpus", file("../../protocol/corpus").absolutePath)
        }
    }
    sourceSets {
        named("main") {
            jniLibs.directories.add("build/jniLibs")
        }
    }
}

val checkKernel = tasks.register("weftCheckKernel") {
    val kernel = layout.projectDirectory.dir("build/jniLibs").asFile
    doLast {
        if (kernel.listFiles().isNullOrEmpty()) {
            throw GradleException(
                "weft: the native kernel for Android is missing ($kernel); build it with native/android/build-core.sh",
            )
        }
    }
}
tasks.named("preBuild") { dependsOn(checkKernel) }

dependencies {
    api("androidx.compose.foundation:foundation:1.12.1")
    api("androidx.compose.material3:material3:1.4.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("androidx.navigation3:navigation3-runtime:1.2.2")
    implementation("androidx.navigation3:navigation3-ui:1.2.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
}
