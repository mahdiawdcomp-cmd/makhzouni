package com.inventory.ui.voice

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.inventory.data.remote.dto.VoicePlanDto
import com.inventory.ui.theme.AppColor
import kotlinx.coroutines.delay

// ── Screen ────────────────────────────────────────────────────────────────────

@Composable
fun VoiceInvoiceScreen(
    onNavigateToInvoice: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: VoiceInvoiceViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val text = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
            if (!text.isNullOrBlank()) viewModel.parseCommand(text)
            else viewModel.resetToIdle()
        } else {
            viewModel.resetToIdle()
        }
    }

    // Auto re-listen after clarification
    LaunchedEffect(uiState) {
        if (uiState is VoiceUiState.NeedsClarification) {
            delay(2800)
            startSpeech(speechLauncher, viewModel)
        }
    }

    Scaffold(
        topBar = {
            @OptIn(ExperimentalMaterial3Api::class)
            TopAppBar(
                title = { Text("المساعد الصوتي") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "رجوع")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                ),
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            // ── Mic button ─────────────────────────────────────────────────────
            MicButton(
                uiState = uiState,
                onClick = {
                    when (uiState) {
                        is VoiceUiState.Idle,
                        is VoiceUiState.Error,
                        is VoiceUiState.Success,
                        is VoiceUiState.GeneralAnswer -> startSpeech(speechLauncher, viewModel)
                        else -> Unit
                    }
                }
            )

            // ── State card ─────────────────────────────────────────────────────
            AnimatedContent(targetState = uiState, label = "voiceState") { state ->
                when (state) {
                    VoiceUiState.Idle      -> HintCard()
                    VoiceUiState.Listening -> StatusCard("🎤  تكلم الآن...", AppColor.Red600)
                    VoiceUiState.Loading   -> StatusCard("⏳  جاري الفهم...", AppColor.Blue600, showProgress = true)
                    VoiceUiState.Executing -> StatusCard("⚙️  جاري التنفيذ...", AppColor.Green600, showProgress = true)

                    is VoiceUiState.NeedsConfirmation -> ConfirmationCard(
                        state      = state,
                        onConfirm  = { viewModel.confirmExecution(state.plan) },
                        onCancel   = { viewModel.resetToIdle() },
                    )

                    is VoiceUiState.NeedsClarification -> StatusCard(
                        text  = "❓  ${state.question}",
                        color = AppColor.Amber600,
                        icon  = { Icon(Icons.Default.HelpOutline, null, tint = AppColor.Amber600) },
                    )

                    is VoiceUiState.GeneralAnswer -> GeneralAnswerCard(
                        text      = state.text,
                        onDismiss = { viewModel.resetToIdle() },
                        onNewVoice = { startSpeech(speechLauncher, viewModel) },
                    )

                    is VoiceUiState.Success -> SuccessCard(
                        state          = state,
                        onOpenInvoice  = { onNavigateToInvoice(state.invoiceId) },
                        onNewCommand   = { viewModel.resetToIdle() },
                    )

                    is VoiceUiState.Error -> StatusCard(
                        text  = "❌  ${state.message}",
                        color = AppColor.Red600,
                        icon  = { Icon(Icons.Default.ErrorOutline, null, tint = AppColor.Red600) },
                    )
                }
            }
        }
    }
}

// ── Mic Button ────────────────────────────────────────────────────────────────

@Composable
private fun MicButton(uiState: VoiceUiState, onClick: () -> Unit) {
    val isListening = uiState is VoiceUiState.Listening
    val isLoading   = uiState is VoiceUiState.Loading || uiState is VoiceUiState.Executing
    val isConfirm   = uiState is VoiceUiState.NeedsConfirmation

    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue  = if (isListening) 1.18f else 1f,
        animationSpec = infiniteRepeatable(tween(600), RepeatMode.Reverse),
        label = "scale",
    )

    val bgColor = when {
        isListening            -> AppColor.Red600
        isLoading              -> Color(0xFF94A3B8)
        isConfirm              -> AppColor.Amber600
        uiState is VoiceUiState.Success -> AppColor.Green600
        uiState is VoiceUiState.GeneralAnswer -> AppColor.Sky500
        else                   -> AppColor.Blue600
    }

    Box(contentAlignment = Alignment.Center) {
        if (isListening) {
            Box(
                modifier = Modifier
                    .size(128.dp)
                    .scale(scale)
                    .background(AppColor.Red600.copy(alpha = 0.2f), CircleShape)
            )
        }
        FilledIconButton(
            onClick  = onClick,
            modifier = Modifier.size(92.dp),
            enabled  = !isLoading && !isConfirm,
            colors   = IconButtonDefaults.filledIconButtonColors(
                containerColor = bgColor,
                contentColor   = Color.White,
            ),
            shape = CircleShape,
        ) {
            if (isLoading) {
                CircularProgressIndicator(color = Color.White, modifier = Modifier.size(32.dp), strokeWidth = 3.dp)
            } else if (isConfirm) {
                Icon(Icons.Default.Pending, null, modifier = Modifier.size(38.dp))
            } else {
                Icon(Icons.Default.Mic, null, modifier = Modifier.size(38.dp))
            }
        }
    }
}

// ── Hint Card ─────────────────────────────────────────────────────────────────

@Composable
private fun HintCard() {
    Surface(
        modifier      = Modifier.fillMaxWidth(),
        shape         = RoundedCornerShape(16.dp),
        color         = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
    ) {
        Column(
            modifier  = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("اضغط الميكروفون وقل:", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            listOf(
                "\"سوّي فاتورة لمحمد، كارتون شاي، نقداً\"",
                "\"سند قبض من أبو علي 50000\"",
                "\"ما هو التوتر الكهربائي في العراق؟\"",
            ).forEach { hint ->
                Surface(shape = RoundedCornerShape(10.dp), color = AppColor.Blue600.copy(alpha = 0.08f)) {
                    Text(
                        hint,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        fontSize = 13.sp,
                        color    = AppColor.Blue600,
                    )
                }
            }
            Text(
                "يمكنك أيضاً طرح أي سؤال عام",
                fontSize = 12.sp,
                color    = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
            )
        }
    }
}

// ── Status Card ───────────────────────────────────────────────────────────────

@Composable
private fun StatusCard(
    text: String,
    color: Color,
    showProgress: Boolean = false,
    icon: (@Composable () -> Unit)? = null,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape    = RoundedCornerShape(16.dp),
        color    = color.copy(alpha = 0.08f),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (showProgress) {
                CircularProgressIndicator(color = color, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
            } else {
                icon?.invoke()
            }
            Text(text, color = color, fontWeight = FontWeight.Medium, fontSize = 14.sp)
        }
    }
}

// ── Confirmation Card ─────────────────────────────────────────────────────────

@Composable
private fun ConfirmationCard(
    state: VoiceUiState.NeedsConfirmation,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    val plan = state.plan

    fun unitLabel(u: String?) = when (u) { "CARTON" -> "كرتون"; "DOZEN" -> "درزن"; else -> "قطعة" }
    fun payLabel(p: String?)  = when (p) { "CASH" -> "نقداً"; "CREDIT" -> "دين"; "PARTIAL" -> "جزئي"; else -> p ?: "" }
    fun vouLabel(v: String?)  = if (v == "PAYMENT") "دفع" else "قبض"

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape    = RoundedCornerShape(16.dp),
        color    = AppColor.Amber600.copy(alpha = 0.07f),
        border   = androidx.compose.foundation.BorderStroke(1.dp, AppColor.Amber600.copy(alpha = 0.25f)),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // Header
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.Pending, null, tint = AppColor.Amber600, modifier = Modifier.size(20.dp))
                Text("تأكيد العملية", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = AppColor.Amber600)
            }

            // Summary text
            Text(
                state.confirmText,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            // Details grid
            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surface) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (plan.operation == "INVOICE") {
                        DetailRow("الزبون", plan.customerName)
                        DetailRow("المنتج", plan.productName ?: "")
                        DetailRow("الكمية", "${plan.quantity ?: 0} ${unitLabel(plan.unit)}")
                        DetailRow("المجموع", "${plan.totalAmount?.toLong()?.let { "%,d".format(it) } ?: 0} د.ع")
                        DetailRow("الدفع", payLabel(plan.paymentType))
                    } else {
                        DetailRow("الزبون", plan.customerName)
                        DetailRow("المبلغ", "${plan.amount?.toLong()?.let { "%,d".format(it) } ?: 0} د.ع")
                        DetailRow("النوع", "سند ${vouLabel(plan.voucherType)}")
                    }
                }
            }

            // Action buttons
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(
                    onClick   = onCancel,
                    modifier  = Modifier.weight(1f),
                    colors    = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
                ) {
                    Icon(Icons.Default.Close, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("إلغاء")
                }
                Button(
                    onClick  = onConfirm,
                    modifier = Modifier.weight(1f),
                    colors   = ButtonDefaults.buttonColors(containerColor = AppColor.Green600),
                ) {
                    Icon(Icons.Default.CheckCircle, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("تأكيد", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

// ── General Answer Card ───────────────────────────────────────────────────────

@Composable
private fun GeneralAnswerCard(
    text: String,
    onDismiss: () -> Unit,
    onNewVoice: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape    = RoundedCornerShape(16.dp),
        color    = AppColor.Sky500.copy(alpha = 0.07f),
        border   = androidx.compose.foundation.BorderStroke(1.dp, AppColor.Sky500.copy(alpha = 0.25f)),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.SmartToy, null, tint = AppColor.Sky500, modifier = Modifier.size(20.dp))
                    Text("جواب المساعد", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = AppColor.Sky500)
                }
                IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Default.Close, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Text(
                text,
                fontSize    = 14.sp,
                lineHeight  = 22.sp,
                color       = MaterialTheme.colorScheme.onSurface,
            )
            OutlinedButton(
                onClick  = onNewVoice,
                modifier = Modifier.fillMaxWidth(),
                colors   = ButtonDefaults.outlinedButtonColors(contentColor = AppColor.Sky500),
            ) {
                Icon(Icons.Default.Mic, null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("سؤال جديد")
            }
        }
    }
}

// ── Success Card ──────────────────────────────────────────────────────────────

@Composable
private fun SuccessCard(
    state: VoiceUiState.Success,
    onOpenInvoice: () -> Unit,
    onNewCommand: () -> Unit,
) {
    fun unitLabel(u: String) = when (u) { "CARTON" -> "كرتون"; "DOZEN" -> "درزن"; else -> "قطعة" }
    fun payLabel(p: String)  = when (p) { "CASH" -> "نقداً"; "CREDIT" -> "دين"; "PARTIAL" -> "جزئي"; else -> p }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape    = RoundedCornerShape(16.dp),
        color    = AppColor.Green600.copy(alpha = 0.07f),
        border   = androidx.compose.foundation.BorderStroke(1.dp, AppColor.Green600.copy(alpha = 0.25f)),
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.CheckCircle, null, tint = AppColor.Green600)
                Text(
                    if (state.isVoucher) "سند رقم ${state.voucherNumber}" else "فاتورة رقم ${state.invoiceNumber}",
                    fontWeight = FontWeight.Bold, fontSize = 16.sp, color = AppColor.Green600,
                )
            }

            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surface) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (state.isVoucher) {
                        DetailRow("الزبون", state.customerName)
                        DetailRow("المبلغ", "%,d".format(state.amount.toLong()) + " د.ع")
                        DetailRow("النوع", if (state.voucherType == "PAYMENT") "سند دفع" else "سند قبض")
                    } else {
                        DetailRow("الزبون", state.customerName)
                        DetailRow("المنتج", state.productName)
                        DetailRow("الكمية", "${state.quantity} ${unitLabel(state.unit)}")
                        DetailRow("المجموع", "%,d".format(state.totalAmount.toLong()) + " د.ع")
                        DetailRow("الدفع", payLabel(state.paymentType))
                    }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = onNewCommand, modifier = Modifier.weight(1f)) {
                    Text("عملية جديدة")
                }
                if (!state.isVoucher && state.invoiceId.isNotEmpty()) {
                    Button(
                        onClick  = onOpenInvoice,
                        modifier = Modifier.weight(1f),
                        colors   = ButtonDefaults.buttonColors(containerColor = AppColor.Green600),
                    ) {
                        Text("عرض الفاتورة", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

// ── Detail Row helper ─────────────────────────────────────────────────────────

@Composable
private fun DetailRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
    }
}

// ── Speech helper ─────────────────────────────────────────────────────────────

private fun startSpeech(
    launcher: androidx.activity.result.ActivityResultLauncher<Intent>,
    viewModel: VoiceInvoiceViewModel,
) {
    viewModel.setListening()
    launcher.launch(
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ar-IQ")
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "ar")
            putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, false)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "تكلم الآن — فاتورة، سند، أو أي سؤال")
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
    )
}
