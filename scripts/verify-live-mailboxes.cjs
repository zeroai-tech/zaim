const {chromium}=require(process.argv[2] || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:950}});
  await page.route('**/api/**',route=>{
   const url=new URL(route.request().url());
   const accounts=[{id:'mailbox',label:'ZeroAI Mail',email:'demo@zeroaitech.tech',isDefault:true},{id:'support',label:'Support team',email:'support@zeroaitech.tech'}];
   let body={ok:true};
   if(url.pathname==='/api/auth/me')body={user:{email:'demo@zeroaitech.tech'},accounts,desktop:false};
   else if(url.pathname==='/api/mail/folders')body={ok:true,folders:[{key:'INBOX',label:'Inbox',icon:'inbox',path:'INBOX'}]};
   else if(url.pathname==='/api/mail/list')body={ok:true,messages:[],total:0};
   route.fulfill({json:body});
  });
  await page.goto('https://zaim.zeroaitech.tech');await page.getByRole('button',{name:'Switch mailbox',exact:true}).click();
  const buttons=page.locator('.account-menu > div > button:first-child');
  const result=await buttons.evaluateAll(els=>els.map(el=>({text:el.textContent,width:el.getBoundingClientRect().width,color:getComputedStyle(el).color})));
  console.log(JSON.stringify(result));
  await page.screenshot({path:'/tmp/zaim-live-mailbox-menu.png'});
  if(process.env.EXPECT_FIXED==='1'){
   assert(result.every(row=>row.width>150),'Unreadable mailbox options');
   await page.getByRole('button',{name:'Switch to support@zeroaitech.tech',exact:true}).click();
   assert((await page.locator('.account-trigger').textContent()).includes('support@zeroaitech.tech'));
   await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Switch mailbox',exact:true}).click();
   const box=await page.locator('.account-menu').boundingBox();assert(box.x>=0 && box.x+box.width<=390);
   await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:950});await page.getByRole('button',{name:'Use dark theme',exact:true}).click();await page.getByRole('button',{name:'Switch mailbox',exact:true}).click();
   const color=await buttons.first().evaluate(el=>getComputedStyle(el).color);assert.notEqual(color,result[0].color);console.log('PASS: live web labels, account switching, mobile bounds and dark theme.');
  }
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
