package com.inventory.ui.voice

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.inventory.ui.common.AppScreen
import com.inventory.ui.common.EmptyState
import com.inventory.ui.theme.AppColor

// ── Screen ────────────────────────────────────────────────────────────────────

@Composable
fun OcrInvoiceScreen(
    onItemsReady: (List<OcrReadyItem>, supplierName: String?) -> Unit,
    onBack: () -> Unit,
    viewModel: OcrInvoiceViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    val galleryLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) viewModel.scanImage(context, uri)
    }

    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicturePreview()
    ) { bitmap ->
        if (bitmap != null) {
            val uri = bitmapToTempUri(context, bitmap)
            if (uri != null) viewModel.scanImage(context, uri)
        }
    }

    AppScreen(title = "قراءة فاتورة مورد", onBack = onBack) { padding ->
        when (val state = uiState) {
            OcrUiState.Idle -> IdlePickerScreen(
                modifier       = Modifier.padding(padding),
                onGallery      = { galleryLauncher.launch("image/*") },
                onCamera       = { cameraLauncher.launch(null) },
            )

            OcrUiState.Scanning -> Box(
                modifier          = Modifier.fillMaxSize().padding(padding),
                contentAlignment  = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment   = Alignment.CenterHorizontally,
                    verticalArrangement   = Arrangement.spacedBy(16.dp),
                ) {
                    CircularProgressIndicator(color = AppColor.Blue600, modifier = Modifier.size(56.dp))
                    Text("جاري قراءة الفاتورة بالذكاء الاصطناعي...", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            is OcrUiState.Result -> ResultScreen(
                state       = state,
                modifier    = Modifier.padding(padding),
                onPatch     = { index, patch -> viewModel.patchDecision(index, patch) },
                onRescan    = { viewModel.resetToIdle() },
                onConfirm   = { viewModel.confirmItems { items -> onItemsReady(items, state.supplierName) } },
            )

            OcrUiState.Creating -> Box(
                modifier         = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment  = Alignment.CenterHorizontally,
                    verticalArrangement  = Arrangement.spacedBy(16.dp),
                ) {
                    CircularProgressIndicator(color = AppColor.Green600, modifier = Modifier.size(56.dp))
                    Text("جاري إنشاء المواد الجديدة...", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            is OcrUiState.Done -> Box(
                modifier         = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                EmptyState(
                    icon        = Icons.Default.CheckCircle,
                    title       = "تم",
                    subtitle    = state.message,
                )
            }

            is OcrUiState.Error -> Box(
                modifier         = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    modifier            = Modifier.padding(24.dp),
                ) {
                    EmptyState(Icons.Default.ErrorOutline, "خطأ", state.message)
                    Button(onClick = { viewModel.resetToIdle() }) {
                        Text("حاول مرة ثانية")
                    }
                }
            }
        }
    }
}

// ── Idle Picker ───────────────────────────────────────────────────────────────

@Composable
private fun IdlePickerScreen(
    modifier: Modifier = Modifier,
    onGallery: () -> Unit,
    onCamera: () -> Unit,
) {
    Column(
        modifier            = modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Default.DocumentScanner,
            null,
            modifier = Modifier.size(72.dp),
            tint     = AppColor.Blue600.copy(alpha = 0.4f),
        )
        Text(
            "قراءة فاتورة شراء من صورة",
            fontSize    = 18.sp,
            fontWeight  = FontWeight.Bold,
            color       = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            "الذكاء الاصطناعي يقرأ الفاتورة ويحدد المواد ويطابقها مع مخزونك",
            fontSize = 13.sp,
            color    = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp),
        )

        Spacer(Modifier.height(8.dp))

        // Camera button
        Button(
            onClick  = onCamera,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            colors   = ButtonDefaults.buttonColors(containerColor = AppColor.Blue600),
        ) {
            Icon(Icons.Default.CameraAlt, null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text("تصوير الفاتورة", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }

        // Gallery button
        OutlinedButton(
            onClick  = onGallery,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            colors   = ButtonDefaults.outlinedButtonColors(contentColor = AppColor.Blue600),
            border   = BorderStroke(1.dp, AppColor.Blue600),
        ) {
            Icon(Icons.Default.Photo, null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text("اختيار من المعرض", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

// ── Result Screen ─────────────────────────────────────────────────────────────

@Composable
private fun ResultScreen(
    state: OcrUiState.Result,
    modifier: Modifier = Modifier,
    onPatch: (Int, OcrItemDecision.() -> OcrItemDecision) -> Unit,
    onRescan: () -> Unit,
    onConfirm: () -> Unit,
) {
    Column(modifier = modifier.fillMaxSize()) {
        // Summary banner
        Surface(
            color    = AppColor.Green600.copy(alpha = 0.08f),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.CheckCircle, null, tint = AppColor.Green600, modifier = Modifier.size(18.dp))
                    Text(state.message, fontWeight = FontWeight.SemiBold, color = AppColor.Green600, fontSize = 14.sp)
                }
                if (!state.supplierName.isNullOrBlank()) {
                    Text("المورد المكتشف: ${state.supplierName}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        // Items list
        LazyColumn(
            modifier             = Modifier.weight(1f),
            contentPadding       = PaddingValues(16.dp),
            verticalArrangement  = Arrangement.spacedBy(12.dp),
        ) {
            itemsIndexed(state.decisions, key = { i, _ -> i }) { index, decision ->
                OcrItemCard(
                    decision = decision,
                    onPatch  = { patch -> onPatch(index, patch) },
                )
            }
        }

        // Bottom actions
        Surface(shadowElevation = 8.dp) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedButton(
                    onClick  = onRescan,
                    modifier = Modifier.weight(1f),
                ) { Text("إعادة المسح") }

                Button(
                    onClick  = onConfirm,
                    modifier = Modifier.weight(1f),
                    colors   = ButtonDefaults.buttonColors(containerColor = AppColor.Green600),
                ) {
                    Icon(Icons.Default.CheckCircle, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("تثبيت المواد", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

// ── Item Card ─────────────────────────────────────────────────────────────────

@Composable
private fun OcrItemCard(
    decision: OcrItemDecision,
    onPatch: (OcrItemDecision.() -> OcrItemDecision) -> Unit,
) {
    val item = decision.item
    val allOptions = buildList {
        item.product?.let { add(it) }
        item.suggestions.forEach { s -> if (item.product?.id != s.id) add(s) }
    }

    val borderColor = when (decision.action) {
        "create" -> AppColor.Amber600.copy(alpha = 0.3f)
        "skip"   -> MaterialTheme.colorScheme.outlineVariant
        else     -> AppColor.Blue600.copy(alpha = 0.25f)
    }
    val bgColor = when (decision.action) {
        "create" -> AppColor.Amber600.copy(alpha = 0.04f)
        "skip"   -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
        else     -> MaterialTheme.colorScheme.surface
    }

    Surface(
        shape  = RoundedCornerShape(14.dp),
        color  = bgColor,
        border = BorderStroke(1.dp, borderColor),
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Header row
            Row(
                modifier              = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment     = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(item.extractedName, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text(
                        "${item.quantity} ${unitLabel(item.unit)} · ${item.unitPrice.toLong().let { "%,d".format(it) }} د.ع",
                        fontSize = 12.sp,
                        color    = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                // Action selector
                ActionChip(
                    selected = decision.action,
                    hasSuggestions = allOptions.isNotEmpty(),
                    onSelect = { action -> onPatch { copy(action = action) } },
                )
            }

            // Match: pick existing product
            AnimatedVisibility(decision.action == "match" && allOptions.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("هل هذه المادة هي؟", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    allOptions.forEach { option ->
                        val selected = decision.selectedProductId == option.id
                        Surface(
                            onClick = { onPatch { copy(selectedProductId = option.id) } },
                            shape   = RoundedCornerShape(10.dp),
                            color   = if (selected) AppColor.Blue600.copy(alpha = 0.1f) else MaterialTheme.colorScheme.surfaceVariant,
                            border  = if (selected) BorderStroke(1.5.dp, AppColor.Blue600) else null,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column {
                                    Text(option.name, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                    Text(option.itemNumber, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (selected) Icon(Icons.Default.CheckCircle, null, tint = AppColor.Blue600, modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                }
            }

            // Create: edit new product fields
            AnimatedVisibility(decision.action == "create") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("بيانات المادة الجديدة", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = AppColor.Amber600)
                    OcrTextField(decision.editedName, "اسم المادة") { onPatch { copy(editedName = it) } }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OcrTextField(
                            decision.editedQuantity.toString(), "الكمية",
                            keyboardType = KeyboardType.Number,
                            modifier = Modifier.weight(1f),
                        ) { v -> onPatch { copy(editedQuantity = v.toIntOrNull() ?: editedQuantity) } }
                        OcrTextField(
                            decision.editedUnitPrice.toLong().toString(), "سعر الشراء",
                            keyboardType = KeyboardType.Number,
                            modifier = Modifier.weight(1f),
                        ) { v -> onPatch { copy(editedUnitPrice = v.toDoubleOrNull() ?: editedUnitPrice) } }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OcrTextField(
                            decision.editedSalePrice.toLong().toString(), "سعر البيع",
                            keyboardType = KeyboardType.Number,
                            modifier = Modifier.weight(1f),
                        ) { v -> onPatch { copy(editedSalePrice = v.toDoubleOrNull() ?: editedSalePrice) } }
                        OcrTextField(
                            decision.editedPcsPerCarton.toString(), "قطع/كرتون",
                            keyboardType = KeyboardType.Number,
                            modifier = Modifier.weight(1f),
                        ) { v -> onPatch { copy(editedPcsPerCarton = v.toIntOrNull() ?: editedPcsPerCarton) } }
                    }
                }
            }
        }
    }
}

// ── Action Chip ───────────────────────────────────────────────────────────────

@Composable
private fun ActionChip(
    selected: String,
    hasSuggestions: Boolean,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }

    val (label, color) = when (selected) {
        "match"  -> Pair("مطابق", AppColor.Blue600)
        "create" -> Pair("جديد", AppColor.Amber600)
        else     -> Pair("تجاهل", MaterialTheme.colorScheme.onSurfaceVariant)
    }

    Box {
        Surface(
            onClick = { expanded = true },
            shape   = RoundedCornerShape(20.dp),
            color   = color.copy(alpha = 0.12f),
            border  = BorderStroke(1.dp, color.copy(alpha = 0.3f)),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = color)
                Icon(Icons.Default.ArrowDropDown, null, tint = color, modifier = Modifier.size(16.dp))
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (hasSuggestions) DropdownMenuItem(
                text = { Text("مطابق لمادة موجودة") },
                onClick = { onSelect("match"); expanded = false },
                leadingIcon = { Icon(Icons.Default.Link, null, tint = AppColor.Blue600) },
            )
            DropdownMenuItem(
                text = { Text("إنشاء مادة جديدة") },
                onClick = { onSelect("create"); expanded = false },
                leadingIcon = { Icon(Icons.Default.AddCircle, null, tint = AppColor.Amber600) },
            )
            DropdownMenuItem(
                text = { Text("تجاهل") },
                onClick = { onSelect("skip"); expanded = false },
                leadingIcon = { Icon(Icons.Default.RemoveCircle, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
            )
        }
    }
}

// ── Text Field helper ─────────────────────────────────────────────────────────

@Composable
private fun OcrTextField(
    value: String,
    label: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    modifier: Modifier = Modifier.fillMaxWidth(),
    onChange: (String) -> Unit,
) {
    OutlinedTextField(
        value         = value,
        onValueChange = onChange,
        label         = { Text(label, fontSize = 12.sp) },
        modifier      = modifier,
        singleLine    = true,
        textStyle     = LocalTextStyle.current.copy(fontSize = 13.sp),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        shape         = RoundedCornerShape(10.dp),
    )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private fun unitLabel(unit: String) = when (unit) {
    "CARTON" -> "كرتون"
    "DOZEN"  -> "درزن"
    else     -> "قطعة"
}

private fun bitmapToTempUri(context: android.content.Context, bitmap: android.graphics.Bitmap): Uri? {
    return try {
        val file = java.io.File(context.cacheDir, "ocr_temp_${System.currentTimeMillis()}.jpg")
        val out  = java.io.FileOutputStream(file)
        bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, out)
        out.close()
        androidx.core.content.FileProvider.getUriForFile(
            context,
            "${context.packageName}.provider",
            file,
        )
    } catch (e: Exception) {
        null
    }
}
