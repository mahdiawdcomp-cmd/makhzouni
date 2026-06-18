import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) {
        file.inputStream().use { load(it) }
    }
}

android {
    namespace = "com.inventory"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.accounting.newapp"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        debug {
            val debugApiUrl = localProperties.getProperty(
                "API_BASE_URL",
                "https://inventory-backend-production-7e85.up.railway.app/api/"
            )
            val debugAdminUrl = localProperties.getProperty(
                "SUPER_ADMIN_API_URL",
                "https://saas-admin-api.up.railway.app"
            )
            buildConfigField("String", "API_BASE_URL", "\"$debugApiUrl\"")
            buildConfigField("String", "SUPER_ADMIN_API_URL", "\"$debugAdminUrl\"")
        }
        release {
            val releaseApiUrl =
                (findProperty("RAILWAY_URL") as String?)
                    ?: localProperties.getProperty("RAILWAY_URL")
                    ?: "https://inventory-backend-production-7e85.up.railway.app/api/"
            val releaseAdminUrl =
                (findProperty("SUPER_ADMIN_API_URL") as String?)
                    ?: localProperties.getProperty("SUPER_ADMIN_API_URL")
                    ?: "https://saas-admin-api.up.railway.app"
            buildConfigField("String", "API_BASE_URL", "\"$releaseApiUrl\"")
            buildConfigField("String", "SUPER_ADMIN_API_URL", "\"$releaseAdminUrl\"")
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.hilt.navigation.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.icons)
    implementation(libs.androidx.splashscreen)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)

    implementation(libs.retrofit)
    implementation(libs.retrofit.gson)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    implementation(libs.datastore.preferences)
    implementation(libs.work.runtime.ktx)
    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.coroutines.android)
    implementation(libs.coil.compose)
    implementation(libs.mlkit.barcode)
    implementation(libs.zxing.core)
    implementation(libs.mpandroidchart)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
