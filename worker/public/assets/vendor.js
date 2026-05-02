import{r as q,g as K,R as Q,a as c}from"./react.js";import{B as $,V as k,a as _,S as Z,b as j,C as z,U as ee,M as te,R as ie}from"./three.js";var R={exports:{}},V={},O={exports:{}},W={};/**
 * @license React
 * use-sync-external-store-shim.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var L;function re(){if(L)return W;L=1;var i=q();function e(u,l){return u===l&&(u!==0||1/u===1/l)||u!==u&&l!==l}var t=typeof Object.is=="function"?Object.is:e,r=i.useState,s=i.useEffect,o=i.useLayoutEffect,m=i.useDebugValue;function n(u,l){var h=l(),b=r({inst:{value:h,getSnapshot:l}}),d=b[0].inst,w=b[1];return o(function(){d.value=h,d.getSnapshot=l,y(d)&&w({inst:d})},[u,h,l]),s(function(){return y(d)&&w({inst:d}),u(function(){y(d)&&w({inst:d})})},[u]),m(h),h}function y(u){var l=u.getSnapshot;u=u.value;try{var h=l();return!t(u,h)}catch{return!0}}function f(u,l){return l()}var v=typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"?f:n;return W.useSyncExternalStore=i.useSyncExternalStore!==void 0?i.useSyncExternalStore:v,W}var U;function se(){return U||(U=1,O.exports=re()),O.exports}/**
 * @license React
 * use-sync-external-store-shim/with-selector.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var I;function ne(){if(I)return V;I=1;var i=q(),e=se();function t(f,v){return f===v&&(f!==0||1/f===1/v)||f!==f&&v!==v}var r=typeof Object.is=="function"?Object.is:t,s=e.useSyncExternalStore,o=i.useRef,m=i.useEffect,n=i.useMemo,y=i.useDebugValue;return V.useSyncExternalStoreWithSelector=function(f,v,u,l,h){var b=o(null);if(b.current===null){var d={hasValue:!1,value:null};b.current=d}else d=b.current;b=n(function(){function p(g){if(!M){if(M=!0,A=g,g=l(g),h!==void 0&&d.hasValue){var x=d.value;if(h(x,g))return S=x}return S=g}if(x=S,r(A,g))return x;var P=l(g);return h!==void 0&&h(x,P)?(A=g,x):(A=g,S=P)}var M=!1,A,S,C=u===void 0?null:u;return[function(){return p(v())},C===null?void 0:function(){return p(C())}]},[v,u,l,h]);var w=s(f,b[0],b[1]);return m(function(){d.hasValue=!0,d.value=w},[w]),y(w),w},V}var G;function oe(){return G||(G=1,R.exports=ne()),R.exports}var ae=oe();const ue=K(ae),B=i=>{let e;const t=new Set,r=(f,v)=>{const u=typeof f=="function"?f(e):f;if(!Object.is(u,e)){const l=e;e=v??(typeof u!="object"||u===null)?u:Object.assign({},e,u),t.forEach(h=>h(e,l))}},s=()=>e,n={setState:r,getState:s,getInitialState:()=>y,subscribe:f=>(t.add(f),()=>t.delete(f))},y=e=i(r,s,n);return n},le=(i=>i?B(i):B),{useSyncExternalStoreWithSelector:he}=ue,ce=i=>i;function fe(i,e=ce,t){const r=he(i.subscribe,i.getState,i.getInitialState,e,t);return Q.useDebugValue(r),r}const T=(i,e)=>{const t=le(i),r=(s,o=e)=>fe(t,s,o);return Object.assign(r,t),r},Ve=((i,e)=>i?T(i,e):T);function N(i,e,t){if(!i)return;if(t(i)===!0)return i;let r=e?i.return:i.child;for(;r;){const s=N(r,e,t);if(s)return s;r=e?null:r.sibling}}function X(i){try{return Object.defineProperties(i,{_currentRenderer:{get(){return null},set(){}},_currentRenderer2:{get(){return null},set(){}}})}catch{return i}}const D=X(c.createContext(null));class de extends c.Component{render(){return c.createElement(D.Provider,{value:this._reactInternals},this.props.children)}}function pe(){const i=c.useContext(D);if(i===null)throw new Error("its-fine: useFiber must be called within a <FiberProvider />!");const e=c.useId();return c.useMemo(()=>{for(const t of[i,i==null?void 0:i.alternate]){if(!t)continue;const r=N(t,!1,s=>{let o=s.memoizedState;for(;o;){if(o.memoizedState===e)return!0;o=o.next}});if(r)return r}},[i,e])}const ve=Symbol.for("react.context"),me=i=>i!==null&&typeof i=="object"&&"$$typeof"in i&&i.$$typeof===ve;function be(){const i=pe(),[e]=c.useState(()=>new Map);e.clear();let t=i;for(;t;){const r=t.type;me(r)&&r!==D&&!e.has(r)&&e.set(r,c.use(X(r))),t=t.return}return e}function Oe(){const i=be();return c.useMemo(()=>Array.from(i.keys()).reduce((e,t)=>r=>c.createElement(e,null,c.createElement(t.Provider,{...r,value:i.get(t)})),e=>c.createElement(de,{...e})),[i])}function H(i,e){let t;return(...r)=>{window.clearTimeout(t),t=window.setTimeout(()=>i(...r),e)}}function We({debounce:i,scroll:e,polyfill:t,offsetSize:r}={debounce:0,scroll:!1,offsetSize:!1}){const s=t||(typeof window>"u"?class{}:window.ResizeObserver);if(!s)throw new Error("This browser does not support ResizeObserver out of the box. See: https://github.com/react-spring/react-use-measure/#resize-observer-polyfills");const[o,m]=c.useState({left:0,top:0,width:0,height:0,bottom:0,right:0,x:0,y:0}),n=c.useRef({element:null,scrollContainers:null,resizeObserver:null,lastBounds:o,orientationHandler:null}),y=i?typeof i=="number"?i:i.scroll:null,f=i?typeof i=="number"?i:i.resize:null,v=c.useRef(!1);c.useEffect(()=>(v.current=!0,()=>void(v.current=!1)));const[u,l,h]=c.useMemo(()=>{const p=()=>{if(!n.current.element)return;const{left:M,top:A,width:S,height:C,bottom:g,right:x,x:P,y:J}=n.current.element.getBoundingClientRect(),E={left:M,top:A,width:S,height:C,bottom:g,right:x,x:P,y:J};n.current.element instanceof HTMLElement&&r&&(E.height=n.current.element.offsetHeight,E.width=n.current.element.offsetWidth),Object.freeze(E),v.current&&!xe(n.current.lastBounds,E)&&m(n.current.lastBounds=E)};return[p,f?H(p,f):p,y?H(p,y):p]},[m,r,y,f]);function b(){n.current.scrollContainers&&(n.current.scrollContainers.forEach(p=>p.removeEventListener("scroll",h,!0)),n.current.scrollContainers=null),n.current.resizeObserver&&(n.current.resizeObserver.disconnect(),n.current.resizeObserver=null),n.current.orientationHandler&&("orientation"in screen&&"removeEventListener"in screen.orientation?screen.orientation.removeEventListener("change",n.current.orientationHandler):"onorientationchange"in window&&window.removeEventListener("orientationchange",n.current.orientationHandler))}function d(){n.current.element&&(n.current.resizeObserver=new s(h),n.current.resizeObserver.observe(n.current.element),e&&n.current.scrollContainers&&n.current.scrollContainers.forEach(p=>p.addEventListener("scroll",h,{capture:!0,passive:!0})),n.current.orientationHandler=()=>{h()},"orientation"in screen&&"addEventListener"in screen.orientation?screen.orientation.addEventListener("change",n.current.orientationHandler):"onorientationchange"in window&&window.addEventListener("orientationchange",n.current.orientationHandler))}const w=p=>{!p||p===n.current.element||(b(),n.current.element=p,n.current.scrollContainers=Y(p),d())};return ge(h,!!e),ye(l),c.useEffect(()=>{b(),d()},[e,h,l]),c.useEffect(()=>b,[]),[w,o,u]}function ye(i){c.useEffect(()=>{const e=i;return window.addEventListener("resize",e),()=>void window.removeEventListener("resize",e)},[i])}function ge(i,e){c.useEffect(()=>{if(e){const t=i;return window.addEventListener("scroll",t,{capture:!0,passive:!0}),()=>void window.removeEventListener("scroll",t,!0)}},[i,e])}function Y(i){const e=[];if(!i||i===document.body)return e;const{overflow:t,overflowX:r,overflowY:s}=window.getComputedStyle(i);return[t,r,s].some(o=>o==="auto"||o==="scroll")&&e.push(i),[...e,...Y(i.parentElement)]}const we=["x","y","top","bottom","left","right","width","height"],xe=(i,e)=>we.every(t=>i[t]===e[t]);var _e=Object.defineProperty,Ae=(i,e,t)=>e in i?_e(i,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):i[e]=t,a=(i,e,t)=>(Ae(i,typeof e!="symbol"?e+"":e,t),t);function F(i,e,t,r,s){let o;if(i=i.subarray||i.slice?i:i.buffer,t=t.subarray||t.slice?t:t.buffer,i=e?i.subarray?i.subarray(e,s&&e+s):i.slice(e,s&&e+s):i,t.set)t.set(i,r);else for(o=0;o<i.length;o++)t[o+r]=i[o];return t}function Se(i){return i instanceof Float32Array?i:i instanceof $?i.getAttribute("position").array:i.map(e=>{const t=Array.isArray(e);return e instanceof k?[e.x,e.y,e.z]:e instanceof j?[e.x,e.y,0]:t&&e.length===3?[e[0],e[1],e[2]]:t&&e.length===2?[e[0],e[1],0]:e}).flat()}class Fe extends ${constructor(){super(),a(this,"type","MeshLine"),a(this,"isMeshLine",!0),a(this,"positions",[]),a(this,"previous",[]),a(this,"next",[]),a(this,"side",[]),a(this,"width",[]),a(this,"indices_array",[]),a(this,"uvs",[]),a(this,"counters",[]),a(this,"widthCallback",null),a(this,"_attributes"),a(this,"_points",[]),a(this,"points"),a(this,"matrixWorld",new te),Object.defineProperties(this,{points:{enumerable:!0,get(){return this._points},set(e){this.setPoints(e,this.widthCallback)}}})}setMatrixWorld(e){this.matrixWorld=e}setPoints(e,t){if(e=Se(e),this._points=e,this.widthCallback=t??null,this.positions=[],this.counters=[],e.length&&e[0]instanceof k)for(let r=0;r<e.length;r++){const s=e[r],o=r/(e.length-1);this.positions.push(s.x,s.y,s.z),this.positions.push(s.x,s.y,s.z),this.counters.push(o),this.counters.push(o)}else for(let r=0;r<e.length;r+=3){const s=r/(e.length-1);this.positions.push(e[r],e[r+1],e[r+2]),this.positions.push(e[r],e[r+1],e[r+2]),this.counters.push(s),this.counters.push(s)}this.process()}compareV3(e,t){const r=e*6,s=t*6;return this.positions[r]===this.positions[s]&&this.positions[r+1]===this.positions[s+1]&&this.positions[r+2]===this.positions[s+2]}copyV3(e){const t=e*6;return[this.positions[t],this.positions[t+1],this.positions[t+2]]}process(){const e=this.positions.length/6;this.previous=[],this.next=[],this.side=[],this.width=[],this.indices_array=[],this.uvs=[];let t,r;this.compareV3(0,e-1)?r=this.copyV3(e-2):r=this.copyV3(0),this.previous.push(r[0],r[1],r[2]),this.previous.push(r[0],r[1],r[2]);for(let s=0;s<e;s++){if(this.side.push(1),this.side.push(-1),this.widthCallback?t=this.widthCallback(s/(e-1)):t=1,this.width.push(t),this.width.push(t),this.uvs.push(s/(e-1),0),this.uvs.push(s/(e-1),1),s<e-1){r=this.copyV3(s),this.previous.push(r[0],r[1],r[2]),this.previous.push(r[0],r[1],r[2]);const o=s*2;this.indices_array.push(o,o+1,o+2),this.indices_array.push(o+2,o+1,o+3)}s>0&&(r=this.copyV3(s),this.next.push(r[0],r[1],r[2]),this.next.push(r[0],r[1],r[2]))}this.compareV3(e-1,0)?r=this.copyV3(1):r=this.copyV3(e-1),this.next.push(r[0],r[1],r[2]),this.next.push(r[0],r[1],r[2]),!this._attributes||this._attributes.position.count!==this.counters.length?this._attributes={position:new _(new Float32Array(this.positions),3),previous:new _(new Float32Array(this.previous),3),next:new _(new Float32Array(this.next),3),side:new _(new Float32Array(this.side),1),width:new _(new Float32Array(this.width),1),uv:new _(new Float32Array(this.uvs),2),index:new _(new Uint16Array(this.indices_array),1),counters:new _(new Float32Array(this.counters),1)}:(this._attributes.position.copyArray(new Float32Array(this.positions)),this._attributes.position.needsUpdate=!0,this._attributes.previous.copyArray(new Float32Array(this.previous)),this._attributes.previous.needsUpdate=!0,this._attributes.next.copyArray(new Float32Array(this.next)),this._attributes.next.needsUpdate=!0,this._attributes.side.copyArray(new Float32Array(this.side)),this._attributes.side.needsUpdate=!0,this._attributes.width.copyArray(new Float32Array(this.width)),this._attributes.width.needsUpdate=!0,this._attributes.uv.copyArray(new Float32Array(this.uvs)),this._attributes.uv.needsUpdate=!0,this._attributes.index.copyArray(new Uint16Array(this.indices_array)),this._attributes.index.needsUpdate=!0),this.setAttribute("position",this._attributes.position),this.setAttribute("previous",this._attributes.previous),this.setAttribute("next",this._attributes.next),this.setAttribute("side",this._attributes.side),this.setAttribute("width",this._attributes.width),this.setAttribute("uv",this._attributes.uv),this.setAttribute("counters",this._attributes.counters),this.setAttribute("position",this._attributes.position),this.setAttribute("previous",this._attributes.previous),this.setAttribute("next",this._attributes.next),this.setAttribute("side",this._attributes.side),this.setAttribute("width",this._attributes.width),this.setAttribute("uv",this._attributes.uv),this.setAttribute("counters",this._attributes.counters),this.setIndex(this._attributes.index),this.computeBoundingSphere(),this.computeBoundingBox()}advance({x:e,y:t,z:r}){const s=this._attributes.position.array,o=this._attributes.previous.array,m=this._attributes.next.array,n=s.length;F(s,0,o,0,n),F(s,6,s,0,n-6),s[n-6]=e,s[n-5]=t,s[n-4]=r,s[n-3]=e,s[n-2]=t,s[n-1]=r,F(s,6,m,0,n-6),m[n-6]=e,m[n-5]=t,m[n-4]=r,m[n-3]=e,m[n-2]=t,m[n-1]=r,this._attributes.position.needsUpdate=!0,this._attributes.previous.needsUpdate=!0,this._attributes.next.needsUpdate=!0}}const Ee=`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  #include <fog_pars_vertex>
  #include <clipping_planes_pars_vertex>

  attribute vec3 previous;
  attribute vec3 next;
  attribute float side;
  attribute float width;
  attribute float counters;
  
  uniform vec2 resolution;
  uniform float lineWidth;
  uniform vec3 color;
  uniform float opacity;
  uniform float sizeAttenuation;
  
  varying vec2 vUV;
  varying vec4 vColor;
  varying float vCounters;
  
  vec2 fix(vec4 i, float aspect) {
    vec2 res = i.xy / i.w;
    res.x *= aspect;
    return res;
  }
  
  void main() {
    float aspect = resolution.x / resolution.y;
    vColor = vec4(color, opacity);
    vUV = uv;
    vCounters = counters;
  
    mat4 m = projectionMatrix * modelViewMatrix;
    vec4 finalPosition = m * vec4(position, 1.0) * aspect;
    vec4 prevPos = m * vec4(previous, 1.0);
    vec4 nextPos = m * vec4(next, 1.0);
  
    vec2 currentP = fix(finalPosition, aspect);
    vec2 prevP = fix(prevPos, aspect);
    vec2 nextP = fix(nextPos, aspect);
  
    float w = lineWidth * width;
  
    vec2 dir;
    if (nextP == currentP) dir = normalize(currentP - prevP);
    else if (prevP == currentP) dir = normalize(nextP - currentP);
    else {
      vec2 dir1 = normalize(currentP - prevP);
      vec2 dir2 = normalize(nextP - currentP);
      dir = normalize(dir1 + dir2);
  
      vec2 perp = vec2(-dir1.y, dir1.x);
      vec2 miter = vec2(-dir.y, dir.x);
      //w = clamp(w / dot(miter, perp), 0., 4. * lineWidth * width);
    }
  
    //vec2 normal = (cross(vec3(dir, 0.), vec3(0., 0., 1.))).xy;
    vec4 normal = vec4(-dir.y, dir.x, 0., 1.);
    normal.xy *= .5 * w;
    //normal *= projectionMatrix;
    if (sizeAttenuation == 0.) {
      normal.xy *= finalPosition.w;
      normal.xy /= (vec4(resolution, 0., 1.) * projectionMatrix).xy * aspect;
    }
  
    finalPosition.xy += normal.xy * side;
    gl_Position = finalPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    #include <clipping_planes_vertex>
    #include <fog_vertex>
  }
`,Me=parseInt(ie.replace(/\D+/g,"")),Ce=Me>=154?"colorspace_fragment":"encodings_fragment",Pe=`
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  #include <clipping_planes_pars_fragment>
  
  uniform sampler2D map;
  uniform sampler2D alphaMap;
  uniform float useGradient;
  uniform float useMap;
  uniform float useAlphaMap;
  uniform float useDash;
  uniform float dashArray;
  uniform float dashOffset;
  uniform float dashRatio;
  uniform float visibility;
  uniform float alphaTest;
  uniform vec2 repeat;
  uniform vec3 gradient[2];
  
  varying vec2 vUV;
  varying vec4 vColor;
  varying float vCounters;
  
  void main() {
    #include <logdepthbuf_fragment>
    vec4 diffuseColor = vColor;
    if (useGradient == 1.) diffuseColor = vec4(mix(gradient[0], gradient[1], vCounters), 1.0);
    if (useMap == 1.) diffuseColor *= texture2D(map, vUV * repeat);
    if (useAlphaMap == 1.) diffuseColor.a *= texture2D(alphaMap, vUV * repeat).a;
    if (diffuseColor.a < alphaTest) discard;
    if (useDash == 1.) diffuseColor.a *= ceil(mod(vCounters + dashOffset, dashArray) - (dashArray * dashRatio));
    diffuseColor.a *= step(vCounters, visibility);
    #include <clipping_planes_fragment>
    gl_FragColor = diffuseColor;     
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <${Ce}>
  }
`;class je extends Z{constructor(e){super({uniforms:{...ee.fog,lineWidth:{value:1},map:{value:null},useMap:{value:0},alphaMap:{value:null},useAlphaMap:{value:0},color:{value:new z(16777215)},gradient:{value:[new z(16711680),new z(65280)]},opacity:{value:1},resolution:{value:new j(1,1)},sizeAttenuation:{value:1},dashArray:{value:0},dashOffset:{value:0},dashRatio:{value:.5},useDash:{value:0},useGradient:{value:0},visibility:{value:1},alphaTest:{value:0},repeat:{value:new j(1,1)}},vertexShader:Ee,fragmentShader:Pe}),a(this,"lineWidth"),a(this,"map"),a(this,"useMap"),a(this,"alphaMap"),a(this,"useAlphaMap"),a(this,"color"),a(this,"gradient"),a(this,"resolution"),a(this,"sizeAttenuation"),a(this,"dashArray"),a(this,"dashOffset"),a(this,"dashRatio"),a(this,"useDash"),a(this,"useGradient"),a(this,"visibility"),a(this,"repeat"),this.type="MeshLineMaterial",Object.defineProperties(this,{lineWidth:{enumerable:!0,get(){return this.uniforms.lineWidth.value},set(t){this.uniforms.lineWidth.value=t}},map:{enumerable:!0,get(){return this.uniforms.map.value},set(t){this.uniforms.map.value=t}},useMap:{enumerable:!0,get(){return this.uniforms.useMap.value},set(t){this.uniforms.useMap.value=t}},alphaMap:{enumerable:!0,get(){return this.uniforms.alphaMap.value},set(t){this.uniforms.alphaMap.value=t}},useAlphaMap:{enumerable:!0,get(){return this.uniforms.useAlphaMap.value},set(t){this.uniforms.useAlphaMap.value=t}},color:{enumerable:!0,get(){return this.uniforms.color.value},set(t){this.uniforms.color.value=t}},gradient:{enumerable:!0,get(){return this.uniforms.gradient.value},set(t){this.uniforms.gradient.value=t}},opacity:{enumerable:!0,get(){return this.uniforms.opacity.value},set(t){this.uniforms.opacity.value=t}},resolution:{enumerable:!0,get(){return this.uniforms.resolution.value},set(t){this.uniforms.resolution.value.copy(t)}},sizeAttenuation:{enumerable:!0,get(){return this.uniforms.sizeAttenuation.value},set(t){this.uniforms.sizeAttenuation.value=t}},dashArray:{enumerable:!0,get(){return this.uniforms.dashArray.value},set(t){this.uniforms.dashArray.value=t,this.useDash=t!==0?1:0}},dashOffset:{enumerable:!0,get(){return this.uniforms.dashOffset.value},set(t){this.uniforms.dashOffset.value=t}},dashRatio:{enumerable:!0,get(){return this.uniforms.dashRatio.value},set(t){this.uniforms.dashRatio.value=t}},useDash:{enumerable:!0,get(){return this.uniforms.useDash.value},set(t){this.uniforms.useDash.value=t}},useGradient:{enumerable:!0,get(){return this.uniforms.useGradient.value},set(t){this.uniforms.useGradient.value=t}},visibility:{enumerable:!0,get(){return this.uniforms.visibility.value},set(t){this.uniforms.visibility.value=t}},alphaTest:{enumerable:!0,get(){return this.uniforms.alphaTest.value},set(t){this.uniforms.alphaTest.value=t}},repeat:{enumerable:!0,get(){return this.uniforms.repeat.value},set(t){this.uniforms.repeat.value.copy(t)}}}),this.setValues(e)}copy(e){return super.copy(e),this.lineWidth=e.lineWidth,this.map=e.map,this.useMap=e.useMap,this.alphaMap=e.alphaMap,this.useAlphaMap=e.useAlphaMap,this.color.copy(e.color),this.gradient=e.gradient,this.opacity=e.opacity,this.resolution.copy(e.resolution),this.sizeAttenuation=e.sizeAttenuation,this.dashArray=e.dashArray,this.dashOffset=e.dashOffset,this.dashRatio=e.dashRatio,this.useDash=e.useDash,this.useGradient=e.useGradient,this.visibility=e.visibility,this.alphaTest=e.alphaTest,this.repeat.copy(e.repeat),this}}export{Fe as M,Ve as a,je as b,pe as c,N as i,We as j,de as m,Oe as x};
