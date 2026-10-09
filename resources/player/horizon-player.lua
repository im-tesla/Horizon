-- Horizon's native playback overlay. MIT licensed, like Horizon.
-- Rendered by mpv over the original video; there is no HTML/video stacking
-- workaround or additional player window. Coordinates are resolution independent.
local mp = require 'mp'
local assdraw = require 'mp.assdraw'
local overlay = mp.create_osd_overlay('ass-events')
overlay.z = 1000
local W, H, mx, my = 1280, 720, -1, -1
local alpha, last_motion, visible = 0, mp.get_time(), false
local menu, drag, hovered, focused = nil, nil, nil, nil
local accent, reduced, fullscreen = 'DAF1B2', false, false
local watch_code, watch_viewers, watch_ready, watch_waiting = '', 0, 0, false
local notice, notice_until, last_seek, pending_seek = '', 0, 0, nil
local regions, menu_scroll = {}, 0
local active = false
local subtitle = {font='Inter',size=36,outline=0.8,shadow=1.2,bold=false,color='white',background=false}
local previous_mouse_x, previous_mouse_y = nil, nil
local subtitle_position = nil
local reported_menu = ''
local function clamp(value, low, high) return math.max(low, math.min(high, value)) end
local function number(name, fallback) return mp.get_property_number(name, fallback or 0) end
local function flag(name) return mp.get_property_bool(name, false) end
local function escape(value) return mp.command_native({'escape-ass', tostring(value or '')}) end
local function truncate(value, count)
    local out, length = {}, 0
    for char in tostring(value):gmatch('[%z\1-\127\194-\244][\128-\191]*') do
        length = length + 1
        if length > count then return table.concat(out) .. '…' end
        out[#out + 1] = char
    end
    return table.concat(out)
end
local function time(value)
    value = math.max(0, math.floor(value or 0))
    if value >= 3600 then return string.format('%d:%02d:%02d', value / 3600, value / 60 % 60, value % 60) end
    return string.format('%d:%02d', value / 60, value % 60)
end
local function message(name, value) mp.commandv('script-message', name, value or '') end
local function wake() last_motion = mp.get_time() end
local function toggle_pause()
    if watch_code ~= '' then message('horizon-control','pause') else mp.commandv('cycle','pause') end
end
local function seek_to(position)
    position = clamp(position,0,number('duration',1e7))
    if watch_code ~= '' then
        if drag and mp.get_time()-last_seek<0.25 then pending_seek=position; return end
        last_seek=mp.get_time(); pending_seek=nil
        mp.commandv('script-message','horizon-control','seek',tostring(position))
    else mp.commandv('seek',position,'absolute+exact') end
end
local function opacity(value) return string.format('%02X', math.floor(255 * (1 - clamp(alpha * (value or 1), 0, 1)))) end
local function text(ass, x, y, value, size, align, color, bold)
    ass:new_event()
    ass:append(string.format('{\\an%d\\pos(%.2f,%.2f)\\fnInter\\fs%d\\b%d\\bord0\\shad0\\1c&H%s&\\alpha&H%s&}', align or 7, x, y, size or 20, bold and 1 or 0, color or 'FFFFFF', opacity()))
    ass:append(escape(value))
end
local function shape(ass, path, color, amount)
    ass:new_event()
    ass:append(string.format('{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H%s&\\alpha&H%s&}', color or 'FFFFFF', opacity(amount)))
    ass:draw_start()
    ass:append(path)
    ass:draw_stop()
end
local function rect(ass, x, y, width, height, color, amount)
    shape(ass, string.format('m %.2f %.2f l %.2f %.2f %.2f %.2f %.2f %.2f', x, y, x + width, y, x + width, y + height, x, y + height), color, amount)
end
local function round_rect(ass, x, y, w, h, radius, color, amount)
    local r, k = math.min(radius, w / 2, h / 2), 0.55228475
    shape(ass, string.format('m %.2f %.2f l %.2f %.2f b %.2f %.2f %.2f %.2f %.2f %.2f l %.2f %.2f b %.2f %.2f %.2f %.2f %.2f %.2f l %.2f %.2f b %.2f %.2f %.2f %.2f %.2f %.2f l %.2f %.2f b %.2f %.2f %.2f %.2f %.2f %.2f',
        x+r,y, x+w-r,y, x+w-r+k*r,y,x+w,y+r-k*r,x+w,y+r,
        x+w,y+h-r, x+w,y+h-r+k*r,x+w-r+k*r,y+h,x+w-r,y+h,
        x+r,y+h, x+r-k*r,y+h,x,y+h-r+k*r,x,y+h-r,
        x,y+r, x,y+r-k*r,x+r-k*r,y,x+r,y), color, amount)
end
local function line(ass, x1, y1, x2, y2, width, color)
    local length = math.sqrt((x2-x1)^2 + (y2-y1)^2)
    if length == 0 then return end
    local dx, dy = (y2-y1)/length*width/2, (x1-x2)/length*width/2
    shape(ass, string.format('m %.2f %.2f l %.2f %.2f %.2f %.2f %.2f %.2f', x1+dx,y1+dy,x2+dx,y2+dy,x2-dx,y2-dy,x1-dx,y1-dy), color)
end
local function icon(ass, name, x, y)
    if name == 'pause' then
        round_rect(ass,x-10,y-14,6,28,1,'FFFFFF'); round_rect(ass,x+4,y-14,6,28,1,'FFFFFF')
    elseif name == 'play' then
        shape(ass,string.format('m %d %d l %d %d %d %d',x-9,y-15,x+14,y,x-9,y+15))
    elseif name == 'back' then
        line(ass,x+12,y,x-12,y,2.5); line(ass,x-12,y,x-2,y-10,2.5); line(ass,x-12,y,x-2,y+10,2.5)
    elseif name == 'rewind' or name == 'forward' then
        local sign = name == 'rewind' and -1 or 1
        -- A broken circular arrow, with a small, legible ten-second label.
        local points = {}
        for i = 0, 24 do
            local angle = (-math.pi/2 + i/24*math.pi*1.72) * sign
            points[#points+1] = {x + math.cos(angle)*14, y + math.sin(angle)*14}
        end
        for i=1,#points-1 do line(ass,points[i][1],points[i][2],points[i+1][1],points[i+1][2],2) end
        shape(ass,string.format('m %.2f %.2f l %.2f %.2f %.2f %.2f',x,y-19,x+sign*7,y-14,x,y-9))
        text(ass,x,y+1,'10',12,5)
    elseif name == 'tracks' then
        round_rect(ass,x-14,y-11,28,21,3,'FFFFFF')
        round_rect(ass,x-12,y-9,24,17,2,'101010')
        shape(ass,string.format('m %d %d l %d %d %d %d',x-7,y+8,x-7,y+16,x,y+8))
        rect(ass,x-7,y-4,14,2,'FFFFFF'); rect(ass,x-7,y+2,10,2,'FFFFFF')
    elseif name == 'subtitle-style' then
        round_rect(ass,x-15,y-12,30,24,4,'FFFFFF')
        round_rect(ass,x-13,y-10,26,20,3,'101010')
        text(ass,x-3,y,'Aa',15,5,'FFFFFF',true)
        line(ass,x+10,y+2,x+10,y+9,2); line(ass,x+7,y+5,x+13,y+5,2)
    elseif name == 'fullscreen' then
        local d = fullscreen and -1 or 1
        for _, corner in ipairs({{-1,-1},{1,-1},{1,1},{-1,1}}) do
            local sx,sy = corner[1],corner[2]
            local cx,cy = x+sx*(fullscreen and 7 or 13),y+sy*(fullscreen and 7 or 13)
            line(ass,cx,cy,cx-sx*9*d,cy,2.4); line(ass,cx,cy,cx,cy-sy*9*d,2.4)
        end
    end
end
local region
local function control_anchor(name)
    for _,r in ipairs(regions) do if r.name==name then return r end end
end
local function popover_bounds(name,w,h)
    local anchor=control_anchor(name)
    local bottom=anchor.y-12
    return clamp(anchor.x+anchor.w-w,24,W-w-24),bottom-h
end
local function style_change(field,value)
    local key=({subtitleFont='font',subtitleSize='size',subtitleOutline='outline',subtitleShadow='shadow',subtitleBold='bold',subtitleColor='color',subtitleBackground='background'})[field]
    if key then subtitle[key]=value end
    mp.commandv('script-message','horizon-subtitle-style',field,tostring(value))
    wake()
end
local function draw_style(ass)
    local bottom=control_anchor('subtitle-style').y-12
    local scale=math.min(1,(bottom-88)/478)
    local w,h=432,478*scale
    local x,y=popover_bounds('subtitle-style',w,h)
    local function ty(offset) return y+offset*scale end
    local function label(offset,value) text(ass,x+24,ty(offset),value,math.floor(18*scale),7,'DDDDDD') end
    local function choice(name,px,offset,width,value,selected,action)
        local py=ty(offset)
        round_rect(ass,px,py,width,34*scale,6,selected and accent or 'FFFFFF',selected and 0.18 or 0.06)
        text(ass,px+width/2,py+17*scale,value,math.floor(16*scale),5,selected and accent or 'DDDDDD')
        region(name,px,py,width,34*scale,action)
    end
    round_rect(ass,x,y,w,h,12,'181818',0.98)
    region('menu-box',x,y,w,h,function() end)
    text(ass,x+24,ty(24),'Subtitle appearance',math.floor(21*scale),7,'FFFFFF',true)
    text(ass,x+w-24,ty(30),'×',math.floor(26*scale),5,'AAAAAA')
    region('style-close',x+w-48,y+8*scale,40,40*scale,function() menu=nil end,'Close subtitle settings')
    label(64,'Font')
    for i,font in ipairs({{name='Inter',label='Modern'},{name='Noto Serif',label='Serif'},{name='Noto Sans Mono',label='Mono'}}) do
        choice('style-font-'..i,x+24+(i-1)*130,89,122,font.label,subtitle.font==font.name,function() style_change('subtitleFont',font.name) end)
    end
    local function step_row(offset,title,field,current,step,low,high)
        label(offset+8,title)
        text(ass,x+276,ty(offset+17),string.format(field=='subtitleSize' and '%d' or '%.1f',current),math.floor(17*scale),5,'EEEEEE')
        choice('style-'..field..'-less',x+310,offset,36,'−',false,function() style_change(field,math.floor(clamp(current-step,low,high)*10+0.5)/10) end)
        choice('style-'..field..'-more',x+354,offset,36,'+',false,function() style_change(field,math.floor(clamp(current+step,low,high)*10+0.5)/10) end)
    end
    step_row(137,'Size','subtitleSize',subtitle.size,2,16,72)
    step_row(181,'Outline','subtitleOutline',subtitle.outline,0.2,0,4)
    step_row(225,'Shadow','subtitleShadow',subtitle.shadow,0.4,0,6)
    label(277,'Weight')
    choice('style-normal',x+200,269,91,'Regular',not subtitle.bold,function() style_change('subtitleBold',false) end)
    choice('style-bold',x+299,269,91,'Bold',subtitle.bold,function() style_change('subtitleBold',true) end)
    label(321,'Color')
    local colors={{name='white',label='White',color='F8F7F7'},{name='warm',label='Warm',color='C5EAFF'},{name='yellow',label='Yellow',color='80DFFF'}}
    for i,color in ipairs(colors) do
        local px=x+208+(i-1)*66
        if subtitle.color==color.name then round_rect(ass,px-3,ty(312),40,36*scale,6,accent,0.2) end
        round_rect(ass,px+6,ty(319),22,22*scale,11,color.color)
        region('style-color-'..color.name,px-3,ty(312),40,36*scale,function() style_change('subtitleColor',color.name) end,color.label)
    end
    label(365,'Background')
    choice('style-background-off',x+200,357,91,'Off',not subtitle.background,function() style_change('subtitleBackground',false) end)
    choice('style-background-on',x+299,357,91,'Soft box',subtitle.background,function() style_change('subtitleBackground',true) end)
    round_rect(ass,x+24,ty(402),w-48,42*scale,7,'000000',0.3)
    local color=subtitle.color=='warm' and 'C5EAFF' or subtitle.color=='yellow' and '80DFFF' or 'F8F7F7'
    ass:new_event()
    ass:append(string.format('{\\an5\\pos(%.2f,%.2f)\\fn%s\\fs%.1f\\b%d\\bord%.1f\\shad%.1f\\1c&H%s&\\3c&H000000&\\4c&H000000&\\alpha&H%s&}',x+w/2,ty(423),subtitle.font,clamp(subtitle.size*0.7,14,34)*scale,subtitle.bold and 1 or 0,subtitle.outline*scale,subtitle.shadow*scale,color,opacity()))
    ass:append(escape('Subtitles, your way.'))
    text(ass,x+24,ty(459),'Text subtitles · saved on this device',math.floor(12*scale),7,'888888')
    text(ass,x+w-24,ty(459),'Reset',math.floor(13*scale),9,'CCCCCC')
    region('style-reset',x+w-90,ty(447),70,26*scale,function() style_change('reset','') end,'Reset subtitle appearance')
end
region = function(name, x, y, w, h, action, label)
    regions[#regions+1] = {name=name,x=x,y=y,w=w,h=h,action=action,label=label}
end
local function hit()
    for i=#regions,1,-1 do
        local r=regions[i]
        if mx>=r.x and mx<=r.x+r.w and my>=r.y and my<=r.y+r.h then return r end
    end
end
local function button(ass, name, x, y, label, action, drawing)
    region(name,x-24,y-24,48,48,action,label)
    if hovered == name or focused == name then round_rect(ass,x-24,y-24,48,48,24,'FFFFFF',0.12) end
    icon(ass,drawing or name,x,y)
end
local languages = {en='English',eng='English',pl='Polish',pol='Polish',de='German',deu='German',fr='French',fra='French',es='Spanish',spa='Spanish',it='Italian',ita='Italian',ja='Japanese',jpn='Japanese',ko='Korean',kor='Korean',ru='Russian',rus='Russian',und='Unknown language'}
local function track_label(track)
    local lang = languages[track.lang] or track.lang
    return truncate(track.title or lang or (track.type == 'audio' and 'Audio' or 'Subtitle') .. ' ' .. track.id, 42)
end
local function draw_menu(ass)
    local tracks={}
    if menu == 'sub' then tracks[#tracks+1]={id='no',title='Off',type='sub',selected=mp.get_property('sid') == 'no'} end
    for _,track in ipairs(mp.get_property_native('track-list',{})) do if track.type == menu then tracks[#tracks+1]=track end end
    local bottom=control_anchor('tracks').y-12
    local max_rows=math.max(1,math.floor((bottom-88-80)/46))
    local rows=math.min(#tracks,7,max_rows)
    local h=80+math.max(1,rows)*46
    local w=432
    local x,y=popover_bounds('tracks',w,h)
    round_rect(ass,x,y,w,h,12,'181818',0.98)
    region('menu-box',x,y,w,h,function() end)
    for i,tab in ipairs({{type='audio',title='Audio'},{type='sub',title='Subtitles'}}) do
        local tx=x+24+(i-1)*190
        text(ass,tx,y+23,tab.title,21,7,tab.type == menu and 'FFFFFF' or '999999',true)
        if tab.type == menu then rect(ass,tx,y+56,154,2,accent) end
        region('tab-'..tab.type,tx,y+12,174,51,function() menu=tab.type; menu_scroll=0; wake() end)
    end
    menu_scroll=clamp(menu_scroll,0,math.max(0,#tracks-rows))
    if #tracks == 0 then text(ass,x+24,y+85,'No audio tracks',18,7,'AAAAAA') end
    for i=1,rows do
        local track=tracks[i+menu_scroll]
        local ry=y+70+(i-1)*46
        local name='track-'..track.type..'-'..track.id
        if hovered==name or focused==name then round_rect(ass,x+12,ry,w-24,42,6,'FFFFFF',0.08) end
        text(ass,x+28,ry+11,track_label(track),18,7,track.selected and accent or 'FFFFFF')
        if track.selected then line(ass,x+w-44,ry+21,x+w-38,ry+27,2,accent); line(ass,x+w-38,ry+27,x+w-28,ry+15,2,accent) end
        region(name,x+12,ry,w-24,42,function() mp.set_property(menu == 'sub' and 'sid' or 'aid',tostring(track.id)); menu=nil; wake() end)
    end
end
local function draw()
    local width,height=mp.get_osd_size()
    if not active or not width or width<2 or not height or height<2 then overlay:remove(); return end
    W=1280; H=math.floor(height/width*W+0.5)
    mp.set_mouse_area(0,0,width,height,'horizon-motion')
    local pointer=mp.get_property_native('mouse-pos',{})
    local x,y=pointer.x or -1,pointer.y or -1
    mx,my=x/width*W,y/height*H
    regions={}
    if alpha < 0.001 then overlay:remove(); return end
    local ass=assdraw.ass_new()
    ass.scale=1
    -- Soft gradients, rather than fixed bars. Each band meets its neighbour.
    for i=0,47 do
        rect(ass,0,H-240+i*5,W,5,'000000',(i/47)^1.8*0.85)
        rect(ass,0,i*3,W,3,'000000',(1-i/47)^2*0.66)
    end
    button(ass,'back',58,54,'Back to title',function() message('horizon-ui','back') end)
    if watch_code ~= '' then
        local label = watch_waiting and string.format('Waiting · %d/%d ready',watch_ready,watch_viewers) or string.format('Together · %s · %d watching',watch_code,watch_viewers)
        local bw = 330
        round_rect(ass,W-bw-32,32,bw,44,22,'202020',0.88)
        text(ass,W-bw/2-32,54,label,17,5,'FFFFFF')
        region('watch-together',W-bw-32,32,bw,44,function() message('horizon-ui','watch-together') end)
    end
    local position,duration=number('time-pos'),number('duration')
    local sx,sw,sy=48,W-96,H-118
    local progress=duration>0 and clamp(position/duration,0,1) or 0
    local near_seek=my>=sy-16 and my<=sy+16 and mx>=sx and mx<=sx+sw
    local sh=(near_seek or drag=='seek') and 6 or 4
    rect(ass,sx,sy-sh/2,sw,sh,'FFFFFF',0.24)
    local cache=mp.get_property_native('demuxer-cache-state',{})
    local buffered=duration>0 and clamp((position+(cache['cache-duration'] or 0))/duration,0,1) or progress
    rect(ass,sx,sy-sh/2,sw*buffered,sh,'FFFFFF',0.34)
    rect(ass,sx,sy-sh/2,sw*progress,sh,accent)
    if near_seek or drag=='seek' then round_rect(ass,sx+sw*progress-6,sy-6,12,12,6,accent) end
    text(ass,sx,sy-26,time(position),15,7,'DDDDDD')
    text(ass,W-48,sy-26,time(duration),15,9,'DDDDDD')
    region('seek',sx,sy-18,sw,36,function() if duration>0 then seek_to(clamp((mx-sx)/sw,0,1)*duration) end end)
    local cy=H-58
    button(ass,'pause',60,cy,flag('pause') and 'Play' or 'Pause',toggle_pause,flag('pause') and 'play' or 'pause')
    button(ass,'rewind',124,cy,'Back 10 seconds',function() seek_to(number('time-pos')-10) end)
    button(ass,'forward',188,cy,'Forward 10 seconds',function() seek_to(number('time-pos')+10) end)
    text(ass,252,cy,truncate(mp.get_property('media-title',''),math.max(18,math.floor((W-548)/12))),20,4,'EEEEEE')
    button(ass,'subtitle-style',W-198,cy,'Subtitle appearance',function() if menu=='style' then menu=nil else menu='style' end end)
    button(ass,'tracks',W-126,cy,'Audio & subtitles',function() if menu and menu~='style' then menu=nil else menu='sub' end; menu_scroll=0 end)
    button(ass,'fullscreen',W-54,cy,fullscreen and 'Exit fullscreen' or 'Fullscreen',function() message('horizon-ui','fullscreen') end)
    if menu=='style' then draw_style(ass) elseif menu then draw_menu(ass) end
    local current=hit()
    hovered=current and current.name or nil
    if current and current.label and not menu then
        local tw=#current.label*8+24
        local tx=clamp(current.x+current.w/2-tw/2,16,W-tw-16)
        local ty=current.y>H/2 and current.y-8-32 or current.y+current.h+8
        round_rect(ass,tx,ty,tw,32,5,'202020',0.96)
        text(ass,tx+tw/2,ty+16,current.label,14,5)
    end
    if flag('paused-for-cache') then text(ass,W/2,H/2,'Buffering…',24,5,'FFFFFF',true) end
    if mp.get_time()<notice_until then text(ass,W/2,H-214,truncate(notice,90),18,5,'FFFFFF') end
    overlay.res_x=W; overlay.res_y=H; overlay.data=ass.text; overlay:update()
end
local function update()
    if not active then return end
    local pointer = mp.get_property_native('mouse-pos')
    if pointer then
        if pointer.x ~= previous_mouse_x or pointer.y ~= previous_mouse_y then wake() end
        previous_mouse_x, previous_mouse_y = pointer.x, pointer.y
    end
    local wanted=flag('pause') or flag('paused-for-cache') or menu~=nil or drag~=nil or focused~=nil or mp.get_time()-last_motion<3 or mp.get_time()<notice_until
    if wanted ~= visible then
        visible=wanted
        mp.set_property('cursor-autohide',wanted and 'no' or '3000')
        message('horizon-ui-state',wanted and 'visible' or 'hidden')
    end
    local position=wanted and (menu=='style' and 90 or 82) or 100
    if position~=subtitle_position then mp.set_property_number('sub-pos',position); subtitle_position=position end
    if (menu or '')~=reported_menu then reported_menu=menu or ''; message('horizon-ui-menu',reported_menu) end
    local target=wanted and 1 or 0
    alpha=reduced and target or alpha+(target-alpha)*0.3
    if math.abs(target-alpha)<0.005 then alpha=target end
    draw()
end
local function mouse_move()
    wake()
    if drag then local r=hit(); if r and r.name==drag then r.action() end end
    update()
end
mp.set_key_bindings({
    {'mouse_move',mouse_move},
},'horizon-motion','force')
mp.enable_key_bindings('horizon-motion','allow-hide-cursor')
mp.add_forced_key_binding('MBTN_LEFT','horizon-click',function(event)
    wake(); update()
    local r=hit()
    if event.event=='down' or event.event=='press' then
        if r then
            if r.name=='seek' then drag=r.name end
            r.action()
        elseif menu then menu=nil
        else toggle_pause() end
    elseif event.event=='up' then drag=nil; if pending_seek then seek_to(pending_seek) end end
    update()
end,{complex=true})
mp.add_forced_key_binding('MBTN_LEFT_DBL','horizon-doubleclick',function()
    -- A fast second click on a control must not also toggle video fullscreen.
    if not hit() then message('horizon-ui','fullscreen') end
end)
mp.add_forced_key_binding('WHEEL_UP','horizon-scroll-up',function() if menu then menu_scroll=math.max(0,menu_scroll-1) end; wake() end)
mp.add_forced_key_binding('WHEEL_DOWN','horizon-scroll-down',function() if menu then menu_scroll=menu_scroll+1 end; wake() end)
for key,action in pairs({SPACE=toggle_pause,LEFT=function() seek_to(number('time-pos')-10) end,RIGHT=function() seek_to(number('time-pos')+10) end,f=function() message('horizon-ui','fullscreen') end,ESC=function() if menu then menu=nil elseif fullscreen then message('horizon-ui','fullscreen') else message('horizon-ui','back') end end,TAB=function() message('horizon-ui','focus-controls') end}) do
    mp.add_forced_key_binding(key,'horizon-key-'..key,function() action(); wake() end)
end
mp.register_script_message('horizon-config',function(color,motion,full,audio,code,viewers,ready,phase)
    if color and color:match('^%x%x%x%x%x%x$') then accent=color end
    reduced=motion=='reduced'; fullscreen=full=='fullscreen'
    watch_code=code or ''; watch_viewers=tonumber(viewers) or 0; watch_ready=tonumber(ready) or 0; watch_waiting=phase=='waiting'
    message('horizon-ui-ready'); wake(); update()
end)
mp.register_script_message('horizon-notice',function(value) notice=value or ''; notice_until=mp.get_time()+4; wake(); update() end)
mp.register_script_message('horizon-subtitle-config',function(font,size,outline,shadow,bold,color,background)
    subtitle={font=font,size=tonumber(size) or 36,outline=tonumber(outline) or 0.8,shadow=tonumber(shadow) or 1.2,bold=bold=='true',color=color,background=background=='true'}
    update()
end)
mp.register_script_message('horizon-focus',function(name) focused=name~='' and name or nil; wake(); update() end)
mp.register_event('file-loaded',function() active=true; alpha=0; wake(); update() end)
mp.register_event('end-file',function() active=false; menu=nil; drag=nil; overlay:remove() end)
mp.add_periodic_timer(1/30,update)
