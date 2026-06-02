package com.inventory.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

@Composable
fun SettingsScreen(viewModel: SettingsViewModel) {
    val state by viewModel.state.collectAsState()
    val settings = state.settings
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        viewModel.update { it.copy(storeLogoUri = uri?.toString()) }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item { Text("الإعدادات", style = MaterialTheme.typography.headlineSmall) }
        item {
            SettingsCard("بيانات المتجر") {
                settings.storeLogoUri?.let { AsyncImage(model = it, contentDescription = null, modifier = Modifier.fillMaxWidth()) }
                Button(onClick = { imagePicker.launch("image/*") }) { Text("اختيار الشعار") }
                OutlinedTextField(settings.storeName, { value -> viewModel.update { it.copy(storeName = value) } }, Modifier.fillMaxWidth(), label = { Text("اسم المتجر") })
                OutlinedTextField(settings.storePhone, { value -> viewModel.update { it.copy(storePhone = value) } }, Modifier.fillMaxWidth(), label = { Text("الهاتف") })
                OutlinedTextField(settings.storeAddress, { value -> viewModel.update { it.copy(storeAddress = value) } }, Modifier.fillMaxWidth(), label = { Text("العنوان") })
                OutlinedTextField(settings.currency, { value -> viewModel.update { it.copy(currency = value) } }, Modifier.fillMaxWidth(), label = { Text("العملة") })
            }
        }
        item {
            SettingsCard("إعدادات الاتصال") {
                OutlinedTextField(settings.baseUrl, { value -> viewModel.update { it.copy(baseUrl = value) } }, Modifier.fillMaxWidth(), label = { Text("رابط Backend API") })
                Button(onClick = viewModel::testConnection) { Text("اختبار الاتصال") }
                state.connectionMessage?.let { Text(it) }
            }
        }
        item {
            SettingsCard("إعدادات التنبيهات") {
                ToggleRow("تذكير الديون", settings.debtReminderEnabled) { value -> viewModel.update { it.copy(debtReminderEnabled = value) } }
                OutlinedTextField(settings.debtReminderDays.toString(), { value -> viewModel.update { it.copy(debtReminderDays = value.toIntOrNull() ?: 14) } }, Modifier.fillMaxWidth(), label = { Text("عدد أيام التأخر") })
                ToggleRow("تنبيه الغياب", settings.inactiveAlertEnabled) { value -> viewModel.update { it.copy(inactiveAlertEnabled = value) } }
                OutlinedTextField(settings.inactiveCustomerDays.toString(), { value -> viewModel.update { it.copy(inactiveCustomerDays = value.toIntOrNull() ?: 30) } }, Modifier.fillMaxWidth(), label = { Text("عدد أيام الغياب") })
            }
        }
        item {
            SettingsCard("قوالب الرسائل") {
                Text("المتغيرات: {customerName} {amount} {invoiceNumber} {daysLate} {storeName} {date}")
                OutlinedTextField(settings.invoiceTemplate, { value -> viewModel.update { it.copy(invoiceTemplate = value) } }, Modifier.fillMaxWidth(), label = { Text("قالب الفاتورة") }, minLines = 3)
                OutlinedTextField(settings.debtTemplate, { value -> viewModel.update { it.copy(debtTemplate = value) } }, Modifier.fillMaxWidth(), label = { Text("قالب تذكير الدين") }, minLines = 3)
                OutlinedTextField(settings.inactiveTemplate, { value -> viewModel.update { it.copy(inactiveTemplate = value) } }, Modifier.fillMaxWidth(), label = { Text("قالب الترحيب بعد غياب") }, minLines = 3)
            }
        }
        item {
            SettingsCard("النسخ الاحتياطي") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = viewModel::exportBackup) { Text("تصدير JSON") }
                    Button(onClick = viewModel::importBackup) { Text("استيراد") }
                }
                state.backupMessage?.let { Text(it) }
            }
        }
    }
}

@Composable
private fun SettingsCard(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}
