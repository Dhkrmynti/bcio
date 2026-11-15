# Bikin garis dalam (offset ke dalam) tiap bentuk logo untuk gaya "bingkai timbul + lekuk dalam".
#   python3 inset_mark.py [lip]   -> mark_inset.json
import json, sys, cv2, numpy as np
LIP = float(sys.argv[1]) if len(sys.argv) > 1 else 0.075   # tebal bingkai, satuan mark (setengah tinggi = 1)
m = json.load(open("mark.json")); S = 2000; C = S / 2; K = S / 2.4
out = []
for sh in m["shapes"]:
    img = np.zeros((S, S), np.uint8)
    pts = np.array([[C + x * K, C - y * K] for x, y in sh["pts"]], np.int32)
    cv2.fillPoly(img, [pts], 255)
    r = int(LIP * K)
    er = cv2.erode(img, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    cs, _ = cv2.findContours(er, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    inner = []
    for c in cs:
        if cv2.contourArea(c) < (r * r): continue
        c = cv2.approxPolyDP(c, 1.5, True).reshape(-1, 2)
        inner.append([[(x - C) / K, (C - y) / K] for x, y in c])
    out.append({"outer": sh["pts"], "inner": inner})
json.dump({"shapes": out}, open("mark_inset.json", "w"))
print([len(s["inner"]) for s in out])
