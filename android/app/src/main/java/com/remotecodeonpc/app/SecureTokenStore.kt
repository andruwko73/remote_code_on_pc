package com.remotecodeonpc.app

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object SecureTokenStore {
    private const val PREFS_NAME = "remote_code_secure_prefs"
    private const val TOKEN_KEY = "auth_token_v1"
    private const val KEY_ALIAS = "remote_code_auth_token_v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"

    fun read(context: Context): String {
        val encrypted = securePrefs(context).getString(TOKEN_KEY, "").orEmpty()
        if (encrypted.isBlank()) return ""
        return runCatching { decrypt(encrypted) }
            .onFailure { CrashLogger.w("SecureTokenStore", "Failed to decrypt saved token: ${it.message}") }
            .getOrDefault("")
    }

    fun write(context: Context, token: String) {
        val prefs = securePrefs(context)
        if (token.isBlank()) {
            prefs.edit().remove(TOKEN_KEY).apply()
            return
        }
        runCatching {
            prefs.edit().putString(TOKEN_KEY, encrypt(token)).apply()
        }.onFailure {
            CrashLogger.e("SecureTokenStore", "Failed to encrypt token", it)
        }
    }

    fun clear(context: Context) {
        securePrefs(context).edit().remove(TOKEN_KEY).apply()
    }

    fun migratePlaintextToken(context: Context, legacyPrefs: SharedPreferences): String {
        val secureToken = read(context)
        val legacyToken = legacyPrefs.getString("authToken", "").orEmpty()
        if (secureToken.isNotBlank()) {
            if (legacyToken.isNotBlank()) {
                legacyPrefs.edit().remove("authToken").apply()
            }
            return secureToken
        }
        if (legacyToken.isBlank()) return ""
        write(context, legacyToken)
        legacyPrefs.edit().remove("authToken").apply()
        return legacyToken
    }

    private fun securePrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val cipherText = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return "${base64(cipher.iv)}:${base64(cipherText)}"
    }

    private fun decrypt(value: String): String {
        val parts = value.split(':', limit = 2)
        require(parts.size == 2) { "Invalid token payload" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, debase64(parts[0])))
        return String(cipher.doFinal(debase64(parts[1])), Charsets.UTF_8)
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let {
            return it.secretKey
        }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    private fun base64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun debase64(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)
}
