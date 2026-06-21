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
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.SettingsBackupRestore
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.filled.WifiTethering
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedCard
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
    var showThemes by remember { mutableStateOf(false) }
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
                    title = "المظهر والتنسيق",
                    titleAction = { Icon(Icons.Default.Palette, null, tint = MaterialTheme.colorScheme.primary) }
                ) {
                    Text(
                        text = "اختَر ألوان التطبيق المناسبة لك. يتغيّر التنسيق فوراً ويُحفظ على هذا الجهاز.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(10.dp))
                    FilledTonalButton(
                        onClick = { showThemes = true },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Palette, null, Modifier.size(18.dp))
                        Spacer(Modifier.size(8.dp))
                        Text("الثيمات")
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
                    Button(onClick = viewModel::downloadBackup, modifier = Modifier.fillMaxWidth()) {
                        Text("تحميل نسخة كاملة من السيرفر")
                    }
                    FilledTonalButton(onClick = viewModel::sendTelegramBackup, modifier = Modifier.fillMaxWidth()) {
                        Text("إرسال نسخة لتيليغرام")
                    }
                    state.backupMessage?.let {
                        val ok = it.startsWith("✓")
                        StatusStrip(text = it, ok = ok)
                    }
                }
            }

            // ── License status ────────────────────────────────────────────────
            state.licenseStatus?.let { lic ->
                if (lic.status != "valid" && lic.status != "missing") {
                    item {
                        SectionCard(title = "الترخيص") {
                            val expired = lic.status == "expired"
                            val msg = if (expired)
                                "انتهت صلاحية الترخيص${if (lic.readOnlyMode) " — وضع القراءة فقط" else " — فترة السماح"}"
                            else
                                "ينتهي الترخيص خلال ${lic.daysLeft} يوم"
                            StatusStrip(text = msg, ok = false)
                            lic.clientName?.let { name ->
                                Text("العميل: $name", style = MaterialTheme.typography.bodySmall)
                            }
                            lic.expiresAt?.let { exp ->
                                Text("تاريخ الانتهاء: ${exp.take(10)}", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
    }

    if (showThemes) {
        ThemePickerDialog(
            selectedTheme = settings.appTheme,
            onSelect = { theme ->
                viewModel.update { it.copy(appTheme = theme) }
                showThemes = false
            },
            onDismiss = { showThemes = false }
        )
    }
}

private data class ThemeChoice(
    val id: String,
    val title: String,
    val description: String,
    val primary: Color,
    val surface: Color,
    val text: Color,
)

@Composable
private fun ThemePickerDialog(
    selectedTheme: String,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val themes = listOf(
        ThemeChoice(
            id = "PROFESSIONAL",
            title = "الأزرق الاحترافي",
            description = "واضح وهادئ للعمل اليومي والمحاسبة",
            primary = Color(0xFF1D4ED8),
            surface = Color(0xFFF8FAFC),
            text = Color(0xFF111827),
        ),
        ThemeChoice(
            id = "EMERALD",
            title = "الزمردي الدافئ",
            description = "أخضر أنيق مع خلفية مريحة للعين",
            primary = Color(0xFF047857),
            surface = Color(0xFFFFFDF8),
            text = Color(0xFF17201B),
        ),
        ThemeChoice(
            id = "MIDNIGHT",
            title = "الليلي الفاخر",
            description = "داكن قوي وواضح للعمل ليلاً",
            primary = Color(0xFF3B82F6),
            surface = Color(0xFF1E293B),
            text = Color(0xFFE2E8F0),
        ),
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Palette, null, tint = MaterialTheme.colorScheme.primary) },
        title = { Text("الثيمات", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                themes.forEach { theme ->
                    val selected = selectedTheme == theme.id
                    OutlinedCard(
                        onClick = { onSelect(theme.id) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.outlinedCardColors(
                            containerColor = if (selected) {
                                MaterialTheme.colorScheme.primaryContainer
                            } else {
                                MaterialTheme.colorScheme.surface
                            }
                        )
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Row(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(theme.surface)
                                    .padding(8.dp),
                                horizontalArrangement = Arrangement.spacedBy(5.dp)
                            ) {
                                Box(Modifier.size(20.dp).background(theme.primary, RoundedCornerShape(6.dp)))
                                Box(Modifier.size(20.dp).background(theme.text, RoundedCornerShape(6.dp)))
                            }
                            Column(Modifier.weight(1f)) {
                                Text(
                                    theme.title,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Text(
                                    theme.description,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            if (selected) {
                                Icon(
                                    Icons.Default.CheckCircle,
                                    contentDescription = "محدد",
                                    tint = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            FilledTonalButton(onClick = onDismiss) { Text("إغلاق") }
        }
    )
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
    val bg = if (ok) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.errorContainer
    val fg = if (ok) MaterialTheme.colorScheme.onTertiaryContainer else MaterialTheme.colorScheme.onErrorContainer
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
