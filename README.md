# 家庭账本（iPhone 网页 App）

全家共用的记账工具：记录支出和存入、拍小票自动识别金额、自动计算余额、多人实时同步。
不用 Mac，不用 Apple 开发者账号，不用租服务器。

## 文件说明

| 文件 | 作用 |
|---|---|
| `index.html` / `style.css` / `app.js` | App 本体 |
| `config.js` | **需要你填写**：Supabase 项目地址和 key |
| `supabase/schema.sql` | 数据库建表脚本（在 Supabase 里运行一次） |
| `sw.js` / `manifest.webmanifest` / `icons/` | 让它能“添加到主屏幕”像 App 一样使用 |

---

## 第 1 步：创建 Supabase 项目（免费，约 5 分钟）

1. 打开 https://supabase.com ，用 GitHub 或邮箱注册登录。
2. 点 **New project**：
   - Name：随便填，如 `family-ledger`
   - Database Password：点生成即可（之后用不到，但请保存好）
   - Region：选 **Northeast Asia (Tokyo)**（在日本使用速度最快）
   - 套餐选 **Free**
3. 等项目创建完成（约 1–2 分钟）。
4. 左侧菜单 **SQL Editor** → **New query**，把 `supabase/schema.sql` 的全部内容粘贴进去 → 点 **Run**，看到 `Success` 即可。
5. 左侧 **Authentication** → **Sign In / Providers**（或 Providers → Email），把 **Confirm email** 关掉 → Save。
   （免费版每小时只能发很少的邮件；关掉后注册即可直接登录，不需要去邮箱确认。）
6. 左侧 **Project Settings** → **API**（新版界面在 **Data API** 和 **API Keys** 里），复制：
   - **Project URL**
   - **anon public** key（新版叫 **publishable key**）
7. 用记事本打开 `config.js`，把两个值填进去并保存：
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: 'https://abcdxyz.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOi...',
   };
   ```
   > anon / publishable key 本来就是给前端公开用的，数据安全由数据库的权限规则保证。
   > **绝对不要**填 `service_role` 或 `secret` key。

## 第 2 步：在电脑上试用（可选）

在项目文件夹打开终端，运行下面的命令，然后用浏览器打开 http://localhost:8000

```bash
python -m http.server 8000
```

电脑上可以注册、记账、看效果。注意：**iPhone 拍照需要 HTTPS**，所以手机要等第 3 步发布后才能用。

## 第 3 步：免费发布到网上（GitHub Pages）

1. 注册 https://github.com 账号。
2. 右上角 **+** → **New repository**，名字填 `zhangben`，选 **Public** → Create。
3. 在新仓库页面点 **uploading an existing file**，把本文件夹里的**所有文件和文件夹**（`icons`、`supabase` 文件夹也要）拖进去 → **Commit changes**。
4. 仓库页面 **Settings** → 左侧 **Pages** → Source 选 **Deploy from a branch**，Branch 选 **main**，目录 **/(root)** → Save。
5. 等 1–2 分钟，页面上会显示网址，形如 `https://你的用户名.github.io/zhangben/`。

> 以后修改了代码，在仓库里重新上传覆盖对应文件即可，几分钟后自动生效。

## 第 4 步：装到全家人的 iPhone 上

1. 用 **Safari** 打开上面的网址（必须是 Safari）。
2. 点底部 **分享** 按钮 → **添加到主屏幕** → 添加。
3. 从桌面图标打开 → **注册**（邮箱 + 密码）。
4. 第一个人选 **新建账本**，填入当前账户里已有的钱作为“初始金额”。
5. 进入 **设置** → **邀请家人** → **分享**，把邀请码发给家人。
6. 家人同样安装、注册后选 **加入家人的账本**，输入邀请码即可。

## 功能

- **金额单位**：日元（¥），没有小数。
- **记一笔**：选择支出或存入，填写金额、分类、备注、日期。
- **拍小票**：点“拍照”或“相册”，App 会在手机本地识别**日本小票**上的「合計」金额并自动填入，请核对后保存。
  会自动跳过「お預り」（付出的现金）、「お釣り」（找零）、消費税、対象金额这些行，支持全角数字和「円」。
  首次识别需要下载日文识别模型（十几 MB），之后会缓存。
- **余额**：余额 = 初始金额 + 所有存入 − 所有支出，由所有流水实时算出，多人同时记账也不会算错。
- **实时同步**：家人记的账会立即出现在你的手机上（账本名旁边的绿点表示已连上）。
- **统计**：按月查看各分类的支出和存入，以及每位成员各花了多少。
- **多账本**：可以同时加入多个账本，比如“家庭日常”“装修专项”。

## 常见问题

**Q：会不会收费？**
免费版额度：数据库 500MB、照片存储 1GB。小票照片压缩后每张约 200KB，够存几千张。家庭使用一般用不完。

**Q：项目被暂停了？**
Supabase 免费项目**连续 7 天没人访问**会自动暂停，登录 Supabase 控制台点 **Restore** 即可恢复，数据不会丢。每天有人记账就不会出现这种情况。

**Q：家人都能改别人记的账吗？**
可以。家庭账本默认所有成员都能修改和删除任何一笔记录。只有账本创建者能改账本名称和初始金额。

**Q：识别的金额不准？**
识别只是辅助填写，保存前请核对金额。小票拍得平整、光线充足，识别会准很多。
