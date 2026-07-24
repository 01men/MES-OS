# 钉钉账号登录配置

## 配置入口

使用具有 `config.read` / `config.write` 权限的账号（默认 `admin`）登录 PC 端，进入：

`左侧菜单 → 规则配置 → 钉钉账号登录`

页面会显示启用开关、Client ID/AppKey、Client Secret/AppSecret、MES 公开访问地址和自动生成的回调地址。Secret 只写入服务端加密字段，查询接口仅返回 `hasSecret`，不会把明文传回浏览器。

## 钉钉开放平台侧

1. 在钉钉开放平台为本企业创建内部网页/H5 应用。
2. 开通统一身份认证所需权限，取得以 `ding` 开头的 AppKey（本系统字段名 Client ID）及 AppSecret。
3. 把 MES 配置页显示的完整地址登记为登录授权回调地址，例如：

   `https://mes.example.com/api/auth/dingtalk/callback`

4. MES 的公开访问地址必须是浏览器实际访问域名；生产环境必须使用 HTTPS，不能填写内网 `127.0.0.1`。
5. 在 MES 保存 AppKey、AppSecret、公开地址并打开“启用”。页面状态变为“可用”后，登录页才显示钉钉登录入口。

## 首次绑定

当前安全模型不依赖姓名或手机号自动匹配。用户先用 MES 账号密码登录，在账号菜单中选择“绑定钉钉”，完成一次授权。此后可从登录页直接使用钉钉账号进入。管理员可在权限审计页面解除异常绑定。

## 环境变量后备配置

```text
MES_DINGTALK_CLIENT_ID=dingxxxxxxxx
MES_DINGTALK_CLIENT_SECRET=xxxxxxxx
MES_PUBLIC_ORIGIN=https://mes.example.com
MES_CONFIG_ENCRYPTION_KEY=<至少 32 字节随机密钥>
```

数据库配置优先，环境变量用于未配置字段的后备。生产环境必须单独设置 `MES_CONFIG_ENCRYPTION_KEY`，不要复用演示值。

