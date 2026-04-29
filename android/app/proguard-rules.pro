# Remote Code on PC ProGuard Rules
-keepclassmembers class com.remotecodeonpc.app.** { *; }
-keepattributes Signature
-keepattributes *Annotation*
-dontwarn okhttp3.**
-dontwarn retrofit2.**
