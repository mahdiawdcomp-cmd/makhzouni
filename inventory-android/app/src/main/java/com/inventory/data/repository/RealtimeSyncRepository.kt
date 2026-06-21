package com.inventory.data.repository

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RealtimeSyncRepository @Inject constructor(
    private val sessionManager: SessionManager,
    @ApplicationContext private val context: Context,
) {
    private val started = AtomicBoolean(false)
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(true)
        .build()

    fun start(scope: CoroutineScope): Job? {
        if (!started.compareAndSet(false, true)) return null

        return scope.launch(Dispatchers.IO) {
            combine(sessionManager.token, sessionManager.baseUrl) { token, baseUrl ->
                token.orEmpty() to baseUrl
            }
                .distinctUntilChanged()
                .collectLatest { (token, baseUrl) ->
                    if (token.isBlank()) {
                        delay(2_000)
                    } else {
                        listenLoop(token, baseUrl)
                    }
                }
        }
    }

    private suspend fun listenLoop(token: String, baseUrl: String) {
        var lastScheduleAt = 0L

        while (currentCoroutineContext().isActive) {
            val encodedToken = URLEncoder.encode(token, Charsets.UTF_8.name())
            val url = "${baseUrl.trimEnd('/')}/realtime/events?token=$encodedToken"
            val request = Request.Builder()
                .url(url)
                .header("Accept", "text/event-stream")
                .build()

            try {
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        delay(5_000)
                        return@use
                    }

                    val source = response.body?.source() ?: return@use
                    while (currentCoroutineContext().isActive) {
                        val line = source.readUtf8Line() ?: break
                        if (line.startsWith("data:")) {
                            val now = System.currentTimeMillis()
                            if (now - lastScheduleAt > 1_500) {
                                lastScheduleAt = now
                                SyncRepository.scheduleNow(context)
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                delay(5_000)
            }
        }
    }
}

