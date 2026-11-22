// The Send to RecipeHub bookmark. Tapped on a recipe page, it opens this RecipeHub (/receive.html)
// and hands it a copy of the page you're looking at: past a security check, or signed in to a
// subscription, it's what you can see. The site's scripts, styles and frames are left out; the
// recipe data (schema.org) and the text are kept. RecipeHub asks before importing it.
//
// It sends the page every half second for up to 30 seconds (RecipeHub may need you to sign in
// first) until RecipeHub says it has it.
export function bookmarklet(origin: string) {
  const C = JSON.stringify(origin);
  const code =
    `(function(){var C=${C};` +
    `var d=document.documentElement.cloneNode(true);` +
    `d.querySelectorAll('script:not([type="application/ld+json"]),style,noscript,svg,iframe,link,template,video,audio').forEach(function(e){e.remove()});` +
    `var m={recipehub:"page",url:location.href,html:"<!DOCTYPE html>"+d.outerHTML};` +
    `var w=window.open(C+"/receive.html","_blank");` +
    `if(!w){alert("Allow pop-ups for this site to send the page to RecipeHub.");return}` +
    `var n=0,t=setInterval(function(){try{w.postMessage(m,C)}catch(e){}if(++n>60)clearInterval(t)},500);` +
    `window.addEventListener("message",function(e){if(e.origin===C&&e.data==="recipehub:got")clearInterval(t)})})()`;
  return `javascript:${encodeURIComponent(code)}`;
}
