-- TV remote: press Down twice (within 2 s) to close mpv. TV Bro keeps the
-- remote's Back button for its own toolbar, so Down doubles as "back".
local last = nil

mp.add_forced_key_binding("DOWN", "double-down-exit", function()
    local now = mp.get_time()
    if last and now - last <= 2 then
        mp.command("quit")
    else
        last = now
        mp.osd_message("Press \226\134\147 again to exit", 2)
    end
end)
