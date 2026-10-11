// 把下面两项换成你自己 Supabase 项目的值
// 位置：Supabase 控制台 → Project Settings → API（或 Data API / API Keys）
//   SUPABASE_URL      → Project URL
//   SUPABASE_ANON_KEY → anon public key（或 publishable key）
// 这个 key 本来就是公开给前端用的，数据安全靠数据库里的行级安全规则保证。
// 千万不要填 service_role / secret key！
window.APP_CONFIG = {
  SUPABASE_URL: 'https://iyarejqlrpobasxloiqe.supabase.co/rest/v1/',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5YXJlanFscnBvYmFzeGxvaXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MzAzMDQsImV4cCI6MjEwNzMwNjMwNH0.0oIGUTNV4Dhn31iLnX_taQYqVq9ViGe_cgkhQfKwKVA',
};
