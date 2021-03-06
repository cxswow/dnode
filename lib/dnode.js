var protocol = require('dnode-protocol');
var Stream = require('stream');
var json = typeof JSON === 'object' ? JSON : require('jsonify');//不同版本间的控制

module.exports = dnode;
dnode.prototype = {};//
(function () { // browsers etc
    for (var key in Stream.prototype) {
        dnode.prototype[key] = Stream.prototype[key];
    }
})();//第一个括号里的函数调用，即执行一次函数里的代码

function dnode (cons, opts) {
    Stream.call(this);//dnode继承自stream
    var self = this;//绑定this
    
    self.opts = opts || {};//dnode的opts默认为{}
    
    //dnode的cons为传入的函数，或一个返回传入的非函数参数或{}的函数
    self.cons = typeof cons === 'function'
        ? cons
        : function () { return cons || {} }
    ;
    
    //设为可读可写
    self.readable = true;
    self.writable = true;
    
    process.nextTick(function () {//下一次轮询后执行
        if (self._ended) return;//结束了dnode就什么都不做
        self.proto = self._createProto();//初始化协议
        self.proto.start();//发送methods消息
        
        //如果有待处理的,逐个处理
        if (!self._handleQueue) return;
        for (var i = 0; i < self._handleQueue.length; i++) {
            self.handle(self._handleQueue[i]);
        }
    });
}

dnode.prototype._createProto = function () {
    var self = this;
    var proto = protocol(function (remote) {//proto会new这个回调函数（new cons(self.remote, self)）
        if (self._ended) return;
        
        var ref = self.cons.call(this, remote, self);//ref为传入dnode的object，传入参数remote和_createProto本身
        if (typeof ref !== 'object') ref = this;
        
        self.emit('local', ref, self);//local事件可以捕捉到自己提供的方法的实例ref
        //通过这个可以在发送给对方消息前修改ref
        
        return ref;
    }, self.opts.proto);
    
    proto.on('remote', function (remote) {
        self.emit('remote', remote, self);//同proto的remote，即收到远端的方法交换消息并处理好了，可以通过remote调用了
        self.emit('ready'); // backwards compatability, deprecated
    });
    
    proto.on('request', function (req) {//proto的request发生于准备好发送一个消息的时候，可以捕捉到要发送的消息req
        if (!self.readable) return;//要发送消息状态应该处于自身可读状态
        
        if (self.opts.emit === 'object') {//可选项emit：设置为object则消息格式为object，否则为JSON格式
            self.emit('data', req);
        }
        else self.emit('data', json.stringify(req) + '\n');
    });
    
    proto.on('fail', function (err) {//远程协议出错，这里可以终止本地的服务
        // errors that the remote end was responsible for
        self.emit('fail', err);
    });
    
    proto.on('error', function (err) {//本地代码错误
        // errors that the local code was responsible for
        self.emit('error', err);
    });
    
    return proto;
};

dnode.prototype.write = function (buf) {//重写stream的.write事件
    if (this._ended) return;
    var self = this;
    var row;
    
    if (buf && typeof buf === 'object'
    && buf.constructor && buf.constructor.name === 'Buffer'
    && buf.length
    && typeof buf.slice === 'function') {
        // treat like a buffer
        if (!self._bufs) self._bufs = [];
        
        // treat like a buffer
        for (var i = 0, j = 0; i < buf.length; i++) {
            if (buf[i] === 0x0a) {//0x0a:换行/n  0x0d:回车/r
                self._bufs.push(buf.slice(j, i));//取换行符前的所有
                
                var line = '';
                for (var k = 0; k < self._bufs.length; k++) {
                    line += String(self._bufs[k]);
                }
                
                try { row = json.parse(line) }
                catch (err) { return self.end() }
                
                j = i + 1;
                
                self.handle(row);
                self._bufs = [];
            }
        }
        
        if (j < buf.length) self._bufs.push(buf.slice(j, buf.length));
    }
    else if (buf && typeof buf === 'object') {
        // .isBuffer() without the Buffer
        // Use self to pipe JSONStream.parse() streams.
        self.handle(buf);
    }
    else {
        if (typeof buf !== 'string') buf = String(buf);
        if (!self._line) self._line = '';
        
        for (var i = 0; i < buf.length; i++) {
            if (buf.charCodeAt(i) === 0x0a) {
                try { row = json.parse(self._line) }
                catch (err) { return self.end() }
                
                self._line = '';
                self.handle(row);
            }
            else self._line += buf.charAt(i)
        }
    }
};

dnode.prototype.handle = function (row) {//调用proto的handle，处理消息
    if (!this.proto) {
        if (!this._handleQueue) this._handleQueue = [];
        this._handleQueue.push(row);
    }
    else this.proto.handle(row);
};

dnode.prototype.end = function () {
    if (this._ended) return;
    this._ended = true;
    this.writable = false;
    this.readable = false;
    this.emit('end');
};

dnode.prototype.destroy = function () {
    this.end();
};
