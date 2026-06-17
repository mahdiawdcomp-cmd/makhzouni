package com.inventory.data.remote

interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>
    data class Queued(val message: String) : ApiResult<Nothing>
    data class Error(val message: String, val code: String? = null) : ApiResult<Nothing>
    data object Offline : ApiResult<Nothing>
}
