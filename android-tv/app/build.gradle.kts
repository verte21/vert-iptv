plugins {
  id("com.android.application")
}

android {
  namespace = "tv.vertiptv.app"
  compileSdk = 34

  defaultConfig {
    applicationId = "tv.vertiptv.app"
    minSdk = 23
    targetSdk = 34
    versionCode = 120
    versionName = "1.2.0"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      // Sign release APK with debug key by default so it installs out-of-the-box on any Android TV / Fire TV
      signingConfig = signingConfigs.getByName("debug")
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    isCoreLibraryDesugaringEnabled = true
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    aidl = false
    buildConfig = false
    shaders = false
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }
}

dependencies {
  coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")
  val media3Version = "1.3.1"
  implementation("androidx.media3:media3-exoplayer:$media3Version")
  implementation("androidx.media3:media3-exoplayer-hls:$media3Version")
  implementation("androidx.media3:media3-exoplayer-dash:$media3Version")
  implementation("androidx.media3:media3-datasource:$media3Version")
  implementation("androidx.media3:media3-common:$media3Version")
  implementation("org.jellyfin.media3:media3-ffmpeg-decoder:1.3.1+2")
}
