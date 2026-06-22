package com.inventory.data.remote

import com.inventory.BuildConfig
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ApiClient @Inject constructor(
    jwtInterceptor: JwtInterceptor,
    dynamicBaseUrlInterceptor: DynamicBaseUrlInterceptor
) {
    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor(dynamicBaseUrlInterceptor)
        .addInterceptor(jwtInterceptor)
        .addInterceptor(HttpLoggingInterceptor().apply {
            // Full request/response bodies (incl. JWTs and customer data) only in
            // debug builds. Release builds log nothing to avoid leaking secrets.
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
                    else HttpLoggingInterceptor.Level.NONE
        })
        .build()

    val api: InventoryApi = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(InventoryApi::class.java)
}
