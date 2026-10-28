#!/usr/bin/env python3
"""Inspect GLB files: print node/mesh counts, animations, and world-space bounding box."""
import json, struct, sys, os

def read_glb(path):
    with open(path, 'rb') as f:
        magic, ver, length = struct.unpack('<4sII', f.read(12))
        assert magic == b'glTF', path
        chunks = {}
        while f.tell() < length:
            clen, ctype = struct.unpack('<I4s', f.read(8))
            data = f.read(clen)
            chunks[ctype] = data
        return json.loads(chunks[b'JSON'].decode('utf-8'))

def accessor_bounds(g, idx):
    a = g['accessors'][idx]
    return a.get('min'), a.get('max'), a.get('count')

def node_world_matrices(g):
    """Compute world matrices (translation+rotation+scale) per node id."""
    import math
    def ident():
        return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
    def mul(a,b):
        r=[0]*16
        for i in range(4):
            for j in range(4):
                s=0
                for k in range(4):
                    s+=a[k*4+i]*b[j*4+k]
                r[j*4+i]=s
        return r
    def from_trs(t,q,s):
        x,y,z,w=q
        xx,yy,zz=x*x,y*y,z*z
        xy,xz,yz=x*y,x*z,y*z
        wx,wy,wz=w*x,w*y,w*z
        m=[ (1-2*(yy+zz))*s[0], 2*(xy+wz)*s[0], 2*(xz-wy)*s[0], 0,
            2*(xy-wz)*s[1], (1-2*(xx+zz))*s[1], 2*(yz+wx)*s[1], 0,
            2*(xz+wy)*s[2], 2*(yz-wx)*s[2], (1-2*(xx+yy))*s[2], 0,
            t[0], t[1], t[2], 1]
        return m
    world = {}
    nodes = g.get('nodes', [])
    def walk(i, parent):
        n = nodes[i]
        if 'matrix' in n:
            local = n['matrix']
        else:
            t = n.get('translation', [0,0,0])
            q = n.get('rotation', [0,0,0,1])
            s = n.get('scale', [1,1,1])
            local = from_trs(t,q,s)
        m = mul(parent, local)
        world[i] = m
        for c in n.get('children', []):
            walk(c, m)
    for scene in [g.get('scene', 0)]:
        for root in g['scenes'][scene].get('nodes', []):
            walk(root, ident())
    return world

def xform(m, p):
    x,y,z = p
    return (m[0]*x+m[4]*y+m[8]*z+m[12],
            m[1]*x+m[5]*y+m[9]*z+m[13],
            m[2]*x+m[6]*y+m[10]*z+m[14])

def report(path):
    g = read_glb(path)
    print(f"\n===== {os.path.basename(path)} ({os.path.getsize(path)/1e6:.1f} MB) =====")
    print(f"  nodes={len(g.get('nodes',[]))} meshes={len(g.get('meshes',[]))} "
          f"materials={len(g.get('materials',[]))} animations={len(g.get('animations',[]))} "
          f"images={len(g.get('images',[]))} skins={len(g.get('skins',[]))}")
    if g.get('animations'):
        for a in g['animations'][:20]:
            print(f"    anim: {a.get('name','<unnamed>')} ({len(a['channels'])} ch)")
    world = node_world_matrices(g)
    lo=[1e18]*3; hi=[-1e18]*3
    nodes = g.get('nodes', [])
    for i,n in enumerate(nodes):
        if 'mesh' not in n: continue
        m = world.get(i)
        if m is None: continue
        for prim in g['meshes'][n['mesh']].get('primitives', []):
            pos = prim.get('attributes', {}).get('POSITION')
            if pos is None: continue
            mn, mx, _ = accessor_bounds(g, pos)
            if not mn or not mx: continue
            for cx in (mn[0], mx[0]):
                for cy in (mn[1], mx[1]):
                    for cz in (mn[2], mx[2]):
                        wx,wy,wz = xform(m,(cx,cy,cz))
                        lo=[min(lo[0],wx),min(lo[1],wy),min(lo[2],wz)]
                        hi=[max(hi[0],wx),max(hi[1],wy),max(hi[2],wz)]
    if lo[0] < 1e17:
        print(f"  bbox min=({lo[0]:.2f},{lo[1]:.2f},{lo[2]:.2f}) max=({hi[0]:.2f},{hi[1]:.2f},{hi[2]:.2f})")
        print(f"  size=({hi[0]-lo[0]:.2f},{hi[1]-lo[1]:.2f},{hi[2]-lo[2]:.2f})")
    # root node names
    roots = g['scenes'][g.get('scene',0)].get('nodes',[])
    print("  roots:", [nodes[r].get('name','?') for r in roots][:12])
    print("  sample node names:", [n.get('name','?') for n in nodes[:15]])

if __name__ == '__main__':
    for p in sys.argv[1:]:
        try:
            report(p)
        except Exception as e:
            print(f"\n!! {p}: {e}")
