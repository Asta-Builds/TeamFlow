<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=true displayInfo=(realm.password!false) && (realm.registrationAllowed!false) && !registrationDisabled??; section>
    <#if section = "header">
        Sign in to your account
    <#elseif section = "form">
    <div id="kc-form">
      <div id="kc-form-wrapper">
        <#if (realm.password!true)>
            <form id="kc-form-login" onsubmit="login.disabled = true; return true;" action="${(url.loginAction)!''}" method="post">
                <div class="form-group">
                    <label for="username">Work Email</label>
                    <input tabindex="1" id="username" class="form-control" name="username" value="${(login.username!'')}" type="text" autofocus autocomplete="off" placeholder="name@example.com" required />
                </div>

                <div class="form-group">
                    <label for="password">Password</label>
                    <input tabindex="2" id="password" class="form-control" name="password" type="password" autocomplete="off" placeholder="••••••••" required />
                </div>

                <#if (realm.rememberMe!false) && !usernameHidden??>
                    <div class="form-group login-pf-settings">
                        <div class="checkbox">
                            <label>
                                <input tabindex="3" id="rememberMe" name="rememberMe" type="checkbox" <#if login?? && login.rememberMe??>checked</#if>> Remember me
                            </label>
                        </div>
                    </div>
                </#if>

                <div id="kc-form-buttons" class="form-group">
                    <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth?? && auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
                    <input tabindex="4" class="btn-primary" name="login" id="kc-login" type="submit" value="Sign In to TeamFlow"/>
                </div>
            </form>
        </#if>
        </div>
    </div>
    <#elseif section = "info" >
        <#if (realm.password!true) && (realm.registrationAllowed!false) && !registrationDisabled??>
            <div id="kc-registration-container">
                <div id="kc-registration">
                    <span>Don't have an account? <a tabindex="6" href="${(url.registrationUrl)!''}">Sign up</a></span>
                </div>
            </div>
        </#if>
    </#if>
</@layout.registrationLayout>
