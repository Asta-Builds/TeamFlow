<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html lang="${(locale.currentLanguageTag)!'en'}">
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="robots" content="noindex, nofollow">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${(realm.displayName)!'TeamFlow'} — Keycloak SSO</title>
    <link rel="stylesheet" href="${(url.resourcesPath)!''}/css/teamflow.css" />
</head>
<body class="${bodyClass!}">
<div class="teamflow-layout">
    <!-- Left Hero Pane (shadcn split-screen style) -->
    <div class="hero-pane">
        <div class="hero-bg-grid"></div>
        <div class="hero-header">
            <div class="brand-badge">TF</div>
            <span class="brand-title">TeamFlow Inc.</span>
        </div>
        
        <div class="hero-quote-box">
            <blockquote class="hero-quote">
                &ldquo;TeamFlow has completely transformed how our virtual tech teams ship production software, coordinate autonomous engineering roles, and manage sprint deliverables seamlessly.&rdquo;
            </blockquote>
            <div class="hero-author">
                <span class="author-name">Sofia Davis</span>
                <span class="author-title">VP of Engineering at CloudScale</span>
            </div>
            
            <div class="system-status">
                <span class="status-dot"></span>
                <span>All systems operational • 🛡️ Keycloak IAM Active</span>
            </div>
        </div>
        
        <div class="hero-footer">
            <span>Enterprise Virtual Tech Management</span>
            <span>v2.0 Keycloak SSO</span>
        </div>
    </div>

    <!-- Right Form Pane (shadcn form style) -->
    <div class="form-pane">
        <div class="form-wrapper">
            <div class="form-header">
                <div class="mobile-logo">TF</div>
                <h1 class="form-title">Welcome back</h1>
                <p class="form-subtitle">Enter your credentials to sign in with Keycloak Single Sign-On</p>
            </div>

            <#if displayMessage && message?has_content>
                <div class="alert alert-${message.type!'info'}">
                    <span>${(message.summary!'')?no_esc}</span>
                </div>
            </#if>

            <#nested "form">

            <#if displayInfo>
                <div id="kc-info">
                    <div id="kc-info-wrapper">
                        <#nested "info">
                    </div>
                </div>
            </#if>

            <div class="form-terms-footer">
                By clicking continue, you agree to our <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
            </div>
        </div>
    </div>
</div>
</body>
</html>
</#macro>
