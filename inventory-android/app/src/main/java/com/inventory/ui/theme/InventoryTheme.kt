package com.inventory.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  FINTECH DESIGN SYSTEM — Color Tokens
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
object AppColor {
    // Primary — deep professional blue
    val Blue900   = Color(0xFF1E3A8A)
    val Blue800   = Color(0xFF1E429F)
    val Blue600   = Color(0xFF1D4ED8)
    val Blue500   = Color(0xFF3B82F6)
    val Blue100   = Color(0xFFDDEAFE)
    val Blue50    = Color(0xFFEFF6FF)

    // Semantic
    val Green600  = Color(0xFF059669)
    val Green100  = Color(0xFFD1FAE5)
    val Green50   = Color(0xFFECFDF5)

    val Amber600  = Color(0xFFD97706)
    val Amber100  = Color(0xFFFDE68A)
    val Amber50   = Color(0xFFFFFBEB)

    val Red600    = Color(0xFFDC2626)
    val Red100    = Color(0xFFFEE2E2)
    val Red50     = Color(0xFFFFF1F2)

    val Purple600 = Color(0xFF7C3AED)
    val Purple100 = Color(0xFFEDE9FE)

    val Sky500    = Color(0xFF0EA5E9)
    val Sky100    = Color(0xFFE0F2FE)

    // Neutral
    val Gray950   = Color(0xFF030712)
    val Gray900   = Color(0xFF111827)
    val Gray800   = Color(0xFF1F2937)
    val Gray700   = Color(0xFF374151)
    val Gray600   = Color(0xFF4B5563)
    val Gray500   = Color(0xFF6B7280)
    val Gray400   = Color(0xFF9CA3AF)
    val Gray300   = Color(0xFFD1D5DB)
    val Gray200   = Color(0xFFE5E7EB)
    val Gray100   = Color(0xFFF3F4F6)
    val Gray50    = Color(0xFFF9FAFB)
    val White     = Color(0xFFFFFFFF)

    // Dark mode surfaces
    val Dark900   = Color(0xFF0F172A)
    val Dark800   = Color(0xFF1E293B)
    val Dark700   = Color(0xFF334155)
    val DarkText  = Color(0xFFE2E8F0)
    val DarkSub   = Color(0xFF94A3B8)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Light Color Scheme
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
private val ProfessionalColors = lightColorScheme(
    primary             = AppColor.Blue600,
    onPrimary           = AppColor.White,
    primaryContainer    = AppColor.Blue100,
    onPrimaryContainer  = AppColor.Blue800,

    secondary           = AppColor.Gray600,
    onSecondary         = AppColor.White,
    secondaryContainer  = AppColor.Gray100,
    onSecondaryContainer= AppColor.Gray900,

    tertiary            = AppColor.Green600,
    onTertiary          = AppColor.White,
    tertiaryContainer   = AppColor.Green100,
    onTertiaryContainer = AppColor.Green600,

    background          = AppColor.Gray100,
    onBackground        = AppColor.Gray900,

    surface             = AppColor.White,
    onSurface           = AppColor.Gray900,
    surfaceVariant      = AppColor.Gray50,
    onSurfaceVariant    = AppColor.Gray600,

    outline             = AppColor.Gray200,
    outlineVariant      = AppColor.Gray100,

    error               = AppColor.Red600,
    onError             = AppColor.White,
    errorContainer      = AppColor.Red100,
    onErrorContainer    = AppColor.Red600,

    inverseSurface      = AppColor.Gray900,
    inverseOnSurface    = AppColor.Gray50,
    inversePrimary      = AppColor.Blue500,
    scrim               = Color(0x52000000),
)

private val EmeraldColors = lightColorScheme(
    primary = Color(0xFF047857),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD1FAE5),
    onPrimaryContainer = Color(0xFF064E3B),
    secondary = Color(0xFF9A3412),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFEDD5),
    onSecondaryContainer = Color(0xFF7C2D12),
    tertiary = Color(0xFFB45309),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFEF3C7),
    onTertiaryContainer = Color(0xFF78350F),
    background = Color(0xFFF4F7F2),
    onBackground = Color(0xFF17201B),
    surface = Color(0xFFFFFDF8),
    onSurface = Color(0xFF17201B),
    surfaceVariant = Color(0xFFE8EFE9),
    onSurfaceVariant = Color(0xFF46554B),
    outline = Color(0xFF87978C),
    outlineVariant = Color(0xFFD4DED6),
    error = Color(0xFFB42318),
    onError = Color.White,
    errorContainer = Color(0xFFFEE4E2),
    onErrorContainer = Color(0xFF7A271A),
    inverseSurface = Color(0xFF243029),
    inverseOnSurface = Color(0xFFF2F7F3),
    inversePrimary = Color(0xFF6EE7B7),
    scrim = Color(0x66000000),
)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Dark Color Scheme
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
private val DarkColors = darkColorScheme(
    primary             = AppColor.Blue500,
    onPrimary           = AppColor.Blue900,
    primaryContainer    = AppColor.Blue800,
    onPrimaryContainer  = AppColor.Blue100,

    secondary           = AppColor.DarkSub,
    onSecondary         = AppColor.Dark900,
    secondaryContainer  = AppColor.Dark700,
    onSecondaryContainer= AppColor.DarkText,

    tertiary            = Color(0xFF34D399),
    onTertiary          = AppColor.Gray950,
    tertiaryContainer   = Color(0xFF064E3B),
    onTertiaryContainer = Color(0xFFA7F3D0),

    background          = AppColor.Dark900,
    onBackground        = AppColor.DarkText,

    surface             = AppColor.Dark800,
    onSurface           = AppColor.DarkText,
    surfaceVariant      = AppColor.Dark700,
    onSurfaceVariant    = AppColor.DarkSub,

    outline             = AppColor.Dark700,
    outlineVariant      = Color(0xFF1E293B),

    error               = Color(0xFFF87171),
    onError             = AppColor.Gray950,
    errorContainer      = Color(0xFF7F1D1D),
    onErrorContainer    = Color(0xFFFCA5A5),

    inverseSurface      = AppColor.DarkText,
    inverseOnSurface    = AppColor.Dark800,
    inversePrimary      = AppColor.Blue600,
    scrim               = Color(0x52000000),
)

enum class AppThemeStyle(val storageValue: String) {
    PROFESSIONAL("PROFESSIONAL"),
    EMERALD("EMERALD"),
    MIDNIGHT("MIDNIGHT");

    companion object {
        fun fromStorage(value: String?): AppThemeStyle =
            entries.firstOrNull { it.storageValue == value } ?: PROFESSIONAL
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Typography
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
private val AppTypography = Typography(
    displayLarge   = TextStyle(fontWeight = FontWeight.Bold,       fontSize = 32.sp, lineHeight = 40.sp, letterSpacing = (-0.5).sp),
    displayMedium  = TextStyle(fontWeight = FontWeight.Bold,       fontSize = 26.sp, lineHeight = 34.sp, letterSpacing = (-0.3).sp),
    displaySmall   = TextStyle(fontWeight = FontWeight.SemiBold,   fontSize = 22.sp, lineHeight = 30.sp),
    headlineLarge  = TextStyle(fontWeight = FontWeight.SemiBold,   fontSize = 20.sp, lineHeight = 28.sp, letterSpacing = (-0.2).sp),
    headlineMedium = TextStyle(fontWeight = FontWeight.SemiBold,   fontSize = 18.sp, lineHeight = 26.sp),
    headlineSmall  = TextStyle(fontWeight = FontWeight.SemiBold,   fontSize = 16.sp, lineHeight = 24.sp),
    titleLarge     = TextStyle(fontWeight = FontWeight.SemiBold,   fontSize = 16.sp, lineHeight = 24.sp),
    titleMedium    = TextStyle(fontWeight = FontWeight.SemiBold,   fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.1.sp),
    titleSmall     = TextStyle(fontWeight = FontWeight.Medium,     fontSize = 13.sp, lineHeight = 18.sp, letterSpacing = 0.1.sp),
    bodyLarge      = TextStyle(fontWeight = FontWeight.Normal,     fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium     = TextStyle(fontWeight = FontWeight.Normal,     fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall      = TextStyle(fontWeight = FontWeight.Normal,     fontSize = 12.sp, lineHeight = 17.sp),
    labelLarge     = TextStyle(fontWeight = FontWeight.Medium,     fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.05.sp),
    labelMedium    = TextStyle(fontWeight = FontWeight.Medium,     fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.04.sp),
    labelSmall     = TextStyle(fontWeight = FontWeight.Medium,     fontSize = 10.sp, lineHeight = 14.sp, letterSpacing = 0.07.sp),
)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Shapes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small      = RoundedCornerShape(8.dp),
    medium     = RoundedCornerShape(12.dp),
    large      = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Theme Entry Point
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
fun InventoryTheme(
    style: AppThemeStyle = AppThemeStyle.PROFESSIONAL,
    content: @Composable () -> Unit
) {
    val colors = when (style) {
        AppThemeStyle.PROFESSIONAL -> ProfessionalColors
        AppThemeStyle.EMERALD -> EmeraldColors
        AppThemeStyle.MIDNIGHT -> DarkColors
    }
    MaterialTheme(
        colorScheme = colors,
        typography  = AppTypography,
        shapes      = AppShapes,
        content     = content,
    )
}
