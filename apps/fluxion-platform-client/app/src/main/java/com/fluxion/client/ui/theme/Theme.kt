package com.fluxion.client.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle

private val CreamColorScheme = lightColorScheme(
    primary = Accent,
    onPrimary = CreamPaper,
    secondary = AccentDark,
    background = CreamBg,
    onBackground = Ink,
    surface = CreamPaper,
    onSurface = Ink,
    surfaceVariant = CreamPaper2,
    onSurfaceVariant = InkSoft,
    outline = Rule2,
    error = StateLocked,
    onError = CreamPaper,
)

// Force the platform sans family across the default type scale; individual
// composables opt into FluxionMono where the mockups use monospace.
private val CreamTypography = Typography().run {
    val sans = TextStyle(fontFamily = FluxionSans)
    copy(
        displayLarge = displayLarge.merge(sans), displayMedium = displayMedium.merge(sans), displaySmall = displaySmall.merge(sans),
        headlineLarge = headlineLarge.merge(sans), headlineMedium = headlineMedium.merge(sans), headlineSmall = headlineSmall.merge(sans),
        titleLarge = titleLarge.merge(sans), titleMedium = titleMedium.merge(sans), titleSmall = titleSmall.merge(sans),
        bodyLarge = bodyLarge.merge(sans), bodyMedium = bodyMedium.merge(sans), bodySmall = bodySmall.merge(sans),
        labelLarge = labelLarge.merge(sans), labelMedium = labelMedium.merge(sans), labelSmall = labelSmall.merge(sans),
    )
}

@Composable
fun FluxionTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = CreamColorScheme,
        typography = CreamTypography,
        content = content,
    )
}
