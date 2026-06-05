package com.inventory.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.SettingsBackupRestore
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.filled.WifiTethering
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.inventory.ui.common.AppScreen
import com.inventory.ui.common.SectionCard
import com.inventory.ui.theme.AppColor

@Composable
fun SettingsScreen(viewModel: SettingsViewModel) {
    val state by viewModel.state.collectAsState()
    val settings = state.settings
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        viewModel.update { it.copy(storeLogoUri = uri?.toString()) }
    }

    AppScreen(title = "الإعدادات") { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                ElevatedCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(Icons.Default.Storefront, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(34.dp))
                        Column(Modifier.weight(1f)) {
                            Text(settings.storeName.ifBlank { "مخزوني" }, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text(settings.baseUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                    }
                }
            }

            item {
                SectionCard(
                    title = "بيانات المتجر",
                    titleAction = { Icon(Icons.Default.Storefront, null, tint = MaterialTheme.colorScheme.primary) }
                ) {
                    settings.storeLogoUri?.let {
                        AsyncImage(
                            model = it,
                            contentDescription = null,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(110.dp)
                                .clip(RoundedCornerShape(10.dp))
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                    FilledTonalButton(onClick = { imagePicker.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.Image, null, Modifier.size(18.dp))
                        Spacer(Modifier.size(8.dp))
                        Text("اختيار الشعار")
                    }
                    CompactField(settings.storeName, { value -> viewModel.update { it.copy(storeName = value) } }, "اسم المتجر")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CompactField(settings.storePhone, { value -> viewModel.update { it.copy(storePhone = value) } }, "الهاتف", Modifier.weight(1f))
                        CompactField(settings.currency, { value -> viewModel.update { it.copy(currency = value) } }, "العملة", Modifier.weight(0.7f))
                    }
                    CompactField(settings.storeAddress, { value -> viewModel.update { it.copy(storeAddress = value) } }, "العنوان")
                }
            }

            item {
                SectionCard(
                    title = "الاتصال",
                    titleAction = { Icon(Icons.Default.WifiTethering, null, tint = MaterialTheme.colorScheme.primary) }
                ) {
                    CompactField(settings.baseUrl, { value -> viewModel.update { it.copy(baseUrl = value) } }, "رابط Backend API")
                    Button(onClick = viewModel::testConnection, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.WifiTethering, null, Modifier.size(18.dp))
                        Spacer(Modifier.size(8.dp))
                        Text("اختبار الاتصال")
                    }
                    state.connectionMessage?.let { message ->
                        val ok = message.contains("ناجح") || message.contains("success", ignoreCase = true)
                        StatusStrip(
                            text = message,
                            ok = ok
                        )
                    }
                }
            }

            item {
                SectionCard(
                    title = "التنبيهات",
                    titleAction = { Icon(Icons.Default.Notifications, null, tint = MaterialTheme.colorScheme.primary) }
                ) {
                    ToggleRow("تذكير الديون", settings.debtReminderEnabled) { value -> viewModel.update { it.copy(debtReminderEnabled = value) } }
                    CompactField(settings.debtReminderDays.toString(), { value -> viewModel.update { it.copy(debtReminderDays = value.toIntOrNull() ?: 14) } }, "أيام التأخر")
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    ToggleRow("تنبيه الغياب", settings.inactiveAlertEnabled) { value -> viewModel.update { it.copy(inactiveAlertEnabled = value) } }
                    CompactField(settings.inactiveCustomerDays.toString(), { value -> viewModel.update { it.copy(inactiveCustomerDays = value.toIntOrNull() ?: 30) } }, "أيام الغياب")
                }
            }

            item {
                SectionCard(title = "قوالب الرسائل") {
                    CompactField(settings.invoiceTemplate, { value -> viewModel.update { it.copy(invoiceTemplate = value) } }, "قالب الفاتورة", minLines = 2)
                    CompactField(settings.debtTemplate, { value -> viewModel.update { it.copy(debtTemplate = value) } }, "قالب تذكير الدين", minLines = 2)
                    CompactField(settings.inactiveTemplate, { value -> viewModel.update { it.copy(inactiveTemplate = value) } }, "قالب الغياب", minLines = 2)
                }
            }

            item {
                SectionCard(
                    title = "النسخ الاحتياطي",
                    titleAction = { Icon(Icons.Default.SettingsBackupRestore, null, tint = MaterialTheme.colorScheme.primary) }
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = viewModel::exportBackup, modifier = Modifier.weight(1f)) { Text("تصدير JSON") }
                        FilledTonalButton(onClick = viewModel::importBackup, modifier = Modifier.weight(1f)) { Text("استيراد") }
                    }
                    state.backupMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
}

@Composable
private fun CompactField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier.fillMaxWidth(),
    minLines: Int = 1
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        label = { Text(label) },
        minLines = minLines,
        singleLine = minLines == 1,
        shape = RoundedCornerShape(10.dp)
    )
}

@Composable
private fun StatusStrip(text: String, ok: Boolean) {
    val bg = if (ok) AppColor.Green50 else AppColor.Red50
    val fg = if (ok) AppColor.Green600 else AppColor.Red600
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(bg, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(if (ok) Icons.Default.CloudDone else Icons.Default.CloudOff, null, tint = fg, modifier = Modifier.size(18.dp))
        Text(text, color = fg, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}
