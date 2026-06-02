package com.inventory.data.repository

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

import kotlinx.coroutines.flow.catch
import androidx.datastore.preferences.core.emptyPreferences

private val Context.dataStore by preferencesDataStore(name = "inventory_session")

@Singleton
class SessionManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val tokenKey = stringPreferencesKey("jwt_token")
    private val roleKey = stringPreferencesKey("user_role")
    private val userNameKey = stringPreferencesKey("user_name")
    private val rememberKey = booleanPreferencesKey("remember_me")
    private val baseUrlKey = stringPreferencesKey("base_url")
    private val storeNameKey = stringPreferencesKey("store_name")
    private val storeLogoKey = stringPreferencesKey("store_logo")
    private val storePhoneKey = stringPreferencesKey("store_phone")
    private val storeAddressKey = stringPreferencesKey("store_address")
    private val currencyKey = stringPreferencesKey("currency")
    private val debtReminderEnabledKey = booleanPreferencesKey("debt_reminder_enabled")
    private val debtReminderDaysKey = intPreferencesKey("debt_reminder_days")
    private val inactiveAlertEnabledKey = booleanPreferencesKey("inactive_alert_enabled")
    private val inactiveCustomerDaysKey = intPreferencesKey("inactive_customer_days")
    private val invoiceTemplateKey = stringPreferencesKey("invoice_template")
    private val debtTemplateKey = stringPreferencesKey("debt_template")
    private val inactiveTemplateKey = stringPreferencesKey("inactive_template")

    private val preferencesFlow = context.dataStore.data.catch { emit(emptyPreferences()) }

    val token = preferencesFlow.map { it[tokenKey] }
    val role = preferencesFlow.map { it[roleKey] }
    val userName = preferencesFlow.map { it[userNameKey] }
    val rememberMe = preferencesFlow.map { it[rememberKey] ?: false }
    val baseUrl = preferencesFlow.map { 
        val saved = it[baseUrlKey]
        if (saved == null || saved.contains("10.0.2.2")) "http://10.153.7.91:5000/api/" else saved
    }
    val storeSettings = preferencesFlow.map {
        StoreSettings(
            storeName = it[storeNameKey] ?: "مخزوني",
            storeLogoUri = it[storeLogoKey],
            storePhone = it[storePhoneKey] ?: "",
            storeAddress = it[storeAddressKey] ?: "",
            currency = it[currencyKey] ?: "IQD",
            baseUrl = if (it[baseUrlKey]?.contains("10.0.2.2") == true) "http://10.153.7.91:5000/api/" else (it[baseUrlKey] ?: "http://10.153.7.91:5000/api/"),
            debtReminderEnabled = it[debtReminderEnabledKey] ?: true,
            debtReminderDays = it[debtReminderDaysKey] ?: 14,
            inactiveAlertEnabled = it[inactiveAlertEnabledKey] ?: true,
            inactiveCustomerDays = it[inactiveCustomerDaysKey] ?: 30,
            invoiceTemplate = it[invoiceTemplateKey] ?: "فاتورتك من {storeName}: {invoiceNumber} بتاريخ {date}",
            debtTemplate = it[debtTemplateKey] ?: "مرحباً {customerName}، لديك مبلغ {amount} مستحق منذ {daysLate} يوم.",
            inactiveTemplate = it[inactiveTemplateKey] ?: "اشتقنالك في {storeName}. يسعدنا رجوعك بأي وقت."
        )
    }

    @Volatile
    private var cachedToken: String? = null

    @Volatile
    private var cachedBaseUrl: String = "http://10.153.7.91:5000/api/"

    val currentToken: String?
        get() = cachedToken

    val currentBaseUrl: String
        get() = cachedBaseUrl

    init {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        scope.launch { token.collect { cachedToken = it } }
        scope.launch { baseUrl.collect { cachedBaseUrl = it } }
    }

    suspend fun hydrateCache() {
        cachedToken = token.first()
        cachedBaseUrl = baseUrl.first()
    }

    suspend fun saveSession(token: String, role: String, name: String, rememberMe: Boolean) {
        cachedToken = token
        context.dataStore.edit {
            it[tokenKey] = token
            it[roleKey] = role
            it[userNameKey] = name
            it[rememberKey] = rememberMe
        }
    }

    suspend fun clearSession() {
        cachedToken = null
        context.dataStore.edit {
            it.remove(tokenKey)
            it.remove(roleKey)
            it.remove(userNameKey)
            it[rememberKey] = false
        }
    }

    suspend fun updateBaseUrl(baseUrl: String) {
        cachedBaseUrl = baseUrl
        context.dataStore.edit {
            it[baseUrlKey] = baseUrl
        }
    }

    suspend fun saveStoreSettings(settings: StoreSettings) {
        cachedBaseUrl = settings.baseUrl
        context.dataStore.edit {
            it[storeNameKey] = settings.storeName
            settings.storeLogoUri?.let { value -> it[storeLogoKey] = value } ?: it.remove(storeLogoKey)
            it[storePhoneKey] = settings.storePhone
            it[storeAddressKey] = settings.storeAddress
            it[currencyKey] = settings.currency
            it[baseUrlKey] = settings.baseUrl
            it[debtReminderEnabledKey] = settings.debtReminderEnabled
            it[debtReminderDaysKey] = settings.debtReminderDays
            it[inactiveAlertEnabledKey] = settings.inactiveAlertEnabled
            it[inactiveCustomerDaysKey] = settings.inactiveCustomerDays
            it[invoiceTemplateKey] = settings.invoiceTemplate
            it[debtTemplateKey] = settings.debtTemplate
            it[inactiveTemplateKey] = settings.inactiveTemplate
        }
    }
}

data class StoreSettings(
    val storeName: String,
    val storeLogoUri: String?,
    val storePhone: String,
    val storeAddress: String,
    val currency: String,
    val baseUrl: String,
    val debtReminderEnabled: Boolean,
    val debtReminderDays: Int,
    val inactiveAlertEnabled: Boolean,
    val inactiveCustomerDays: Int,
    val invoiceTemplate: String,
    val debtTemplate: String,
    val inactiveTemplate: String
)
