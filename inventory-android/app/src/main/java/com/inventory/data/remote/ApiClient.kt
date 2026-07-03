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
    dynamicBaseUrlInterceptor: DynamicBaseUrlInterceptor,
    entitlementInterceptor: EntitlementInterceptor
) {
    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor(dynamicBaseUrlInterceptor)
        .addInterceptor(jwtInterceptor)
        // Placed BEFORE the logging interceptor on purpose. Application interceptors
        // added first are OUTERMOST; the logging interceptor (added after) is inner
        // and closer to the network, so it always sees & logs the true raw 403/423
        // response BEFORE this interceptor inspects it and (only for recognized
        // entitlement codes) throws EntitlementException. This is the reverse of the
        // task-brief's restated ordering, which — verified against OkHttp's
        // outer-first application-interceptor semantics — would have made logging
        // (outer) observe the thrown exception instead of the raw response.
        .addInterceptor(entitlementInterceptor)
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
